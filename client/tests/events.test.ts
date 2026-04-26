/**
 * subscribeToEvents tests.
 *
 * Uses jest fake timers to control the 5-second polling loop.
 * The @stellar/stellar-sdk mock is defined at module level.
 */

import { makeSdk, TEST_CONTRACT_ID } from "./helpers/sdkFactory";

// The module mock must match the one in sdk.test.ts — topics are decoded via
// xdr.ScVal.fromXDR + scValToNative. Our mock returns the raw string as-is
// from scValToNative so we can match on it directly.
jest.mock("@stellar/stellar-sdk", () => {
    return {
        rpc: {
            Server: class {
                constructor() { }
                async getAccount() { return { accountId: "GMOCK", sequence: "0" }; }
                async simulateTransaction() { return { result: { retval: null }, minResourceFee: "1000" }; }
                async prepareTransaction(tx: any) { return tx; }
                async sendTransaction() { return { status: "PENDING", hash: "mockhash" }; }
                async getEvents() { return { events: [] }; }
            },
        },
        Contract: class {
            constructor() { }
            call(method: string, ...args: unknown[]) { return { method, args }; }
        },
        TransactionBuilder: class {
            static fromXDR() { return { toXDR: () => "SIGNED_TX_XDR" }; }
            constructor() { }
            addOperation() { return this; }
            setTimeout() { return this; }
            setSorobanData() { return this; }
            build() { return { toXDR: () => "TX_XDR" }; }
        },
        nativeToScVal: (value: unknown) => ({ _scval: value }),
        scValToNative: (val: any) => {
            // For topic matching: return the raw string so tests can match on it
            if (val && typeof val === "object" && "_topic" in val) return val._topic;
            return val?._native ?? { ok: true };
        },
        xdr: {
            ScVal: {
                // fromXDR returns an object with _topic so scValToNative can extract it
                fromXDR: (b64: string, _fmt: string) => ({ _topic: b64 }),
            },
            SorobanTransactionData: class { },
        },
    };
});

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe("subscribeToEvents", () => {
    it("calls getEvents with a filter containing the contract ID (Property 12)", async () => {
        const { sdk, mockServer } = makeSdk();
        mockServer.getEvents.mockResolvedValue({ events: [] });

        const unsub = sdk.subscribeToEvents(jest.fn());

        // Let the initial poll run
        await Promise.resolve();
        await Promise.resolve();

        expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
        const req = mockServer.getEvents.mock.calls[0][0];
        expect(req.filters[0].contractIds).toContain(TEST_CONTRACT_ID);

        unsub();
    });

    it("invokes callback once per event returned (Property 13)", async () => {
        const { sdk, mockServer } = makeSdk();
        const events = [
            { id: "1", topic: [], value: "a" },
            { id: "2", topic: [], value: "b" },
            { id: "3", topic: [], value: "c" },
        ];
        mockServer.getEvents.mockResolvedValueOnce({ events });

        const callback = jest.fn();
        const unsub = sdk.subscribeToEvents(callback);

        await Promise.resolve();
        await Promise.resolve();

        expect(callback).toHaveBeenCalledTimes(3);
        unsub();
    });

    it("includes startLedger in first request when no cursor is set", async () => {
        const { sdk, mockServer } = makeSdk();
        mockServer.getEvents.mockResolvedValue({ events: [] });

        const unsub = sdk.subscribeToEvents(jest.fn(), { startLedger: 42 });

        await Promise.resolve();
        await Promise.resolve();

        const req = mockServer.getEvents.mock.calls[0][0];
        expect(req.startLedger).toBe(42);

        unsub();
    });

    it("does not include startLedger when cursor is already set", async () => {
        const { sdk, mockServer } = makeSdk();

        // First poll returns an event with an id (sets cursor)
        mockServer.getEvents
            .mockResolvedValueOnce({ events: [{ id: "cursor-1", topic: [] }] })
            .mockResolvedValue({ events: [] });

        const unsub = sdk.subscribeToEvents(jest.fn(), { startLedger: 10 });

        // First poll
        await Promise.resolve();
        await Promise.resolve();

        // Advance timer to trigger second poll
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        const secondReq = mockServer.getEvents.mock.calls[1][0];
        expect(secondReq.startLedger).toBeUndefined();
        expect(secondReq.pagination?.cursor).toBe("cursor-1");

        unsub();
    });

    it("advances cursor to last event id after a poll", async () => {
        const { sdk, mockServer } = makeSdk();

        mockServer.getEvents
            .mockResolvedValueOnce({
                events: [
                    { id: "ev-1", topic: [] },
                    { id: "ev-2", topic: [] },
                ],
            })
            .mockResolvedValue({ events: [] });

        const unsub = sdk.subscribeToEvents(jest.fn());

        await Promise.resolve();
        await Promise.resolve();

        jest.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        const secondReq = mockServer.getEvents.mock.calls[1][0];
        expect(secondReq.pagination?.cursor).toBe("ev-2");

        unsub();
    });

    it("filters events by eventName — only matching topics invoke callback (Property 7)", async () => {
        const { sdk, mockServer } = makeSdk();

        // Topics are base64 strings; our mock's xdr.ScVal.fromXDR returns { _topic: b64 }
        // and scValToNative returns that b64 string, so we match on the raw string.
        const matchingEvent = { id: "1", topic: ["grant_created"], value: "x" };
        const nonMatchingEvent = { id: "2", topic: ["grant_funded"], value: "y" };

        mockServer.getEvents.mockResolvedValueOnce({
            events: [matchingEvent, nonMatchingEvent],
        });

        const callback = jest.fn();
        const unsub = sdk.subscribeToEvents(callback, { eventName: "grant_created" });

        await Promise.resolve();
        await Promise.resolve();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(matchingEvent);

        unsub();
    });

    it("does not invoke callback for events with no matching topic", async () => {
        const { sdk, mockServer } = makeSdk();

        mockServer.getEvents.mockResolvedValueOnce({
            events: [{ id: "1", topic: ["other_event"], value: "x" }],
        });

        const callback = jest.fn();
        const unsub = sdk.subscribeToEvents(callback, { eventName: "grant_created" });

        await Promise.resolve();
        await Promise.resolve();

        expect(callback).not.toHaveBeenCalled();

        unsub();
    });

    it("unsubscribe stops future callback invocations (Property 8)", async () => {
        const { sdk, mockServer } = makeSdk();

        mockServer.getEvents.mockResolvedValue({
            events: [{ id: "1", topic: [], value: "x" }],
        });

        const callback = jest.fn();
        const unsub = sdk.subscribeToEvents(callback);

        // Let first poll run
        await Promise.resolve();
        await Promise.resolve();

        const callsAfterFirst = callback.mock.calls.length;

        // Unsubscribe before next poll
        unsub();

        // Advance timer — should NOT trigger another poll
        jest.advanceTimersByTime(5000);
        await Promise.resolve();
        await Promise.resolve();

        expect(callback.mock.calls.length).toBe(callsAfterFirst);
    });

    it("continues polling without crashing when getEvents throws", async () => {
        const { sdk, mockServer } = makeSdk();

        mockServer.getEvents.mockRejectedValueOnce(new Error("network error"));

        const callback = jest.fn();
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => { });

        const unsub = sdk.subscribeToEvents(callback);

        await Promise.resolve();
        await Promise.resolve();

        // Callback should not have been called
        expect(callback).not.toHaveBeenCalled();
        // No unhandled rejection — test itself passes

        warnSpy.mockRestore();
        unsub();
    });
});
