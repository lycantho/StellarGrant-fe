use crate::types::MilestoneState;
use soroban_sdk::{contracttype, symbol_short, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneVoted {
    pub reviewer: Address,
    pub approve: bool,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneRejected {
    pub reviewer: Address,
    pub reason: String,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct MilestoneStatusChanged {
    pub grant_id: u64,
    pub milestone_idx: u32,
    pub new_state: MilestoneState,
    pub timestamp: u64,
}

pub fn milestone_voted(
    env: &Env,
    grant_id: u64,
    milestone_idx: u32,
    reviewer: Address,
    approve: bool,
) {
    let topics = (symbol_short!("voted"), grant_id, milestone_idx);
    let data = (reviewer, approve, env.ledger().timestamp());
    #[allow(deprecated)]
    env.events().publish(topics, data);
}

pub fn milestone_rejected(
    env: &Env,
    grant_id: u64,
    milestone_idx: u32,
    reviewer: Address,
    reason: String,
) {
    let topics = (symbol_short!("rejected"), grant_id, milestone_idx);
    let data = (reviewer, reason, env.ledger().timestamp());
    #[allow(deprecated)]
    env.events().publish(topics, data);
}

pub fn milestone_status_changed(
    env: &Env,
    grant_id: u64,
    milestone_idx: u32,
    new_state: MilestoneState,
) {
    let topics = (symbol_short!("status"), grant_id, milestone_idx);
    let data = (new_state, env.ledger().timestamp());
    #[allow(deprecated)]
    env.events().publish(topics, data);
}
