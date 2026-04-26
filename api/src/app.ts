import express from "express";
import helmet from "helmet";
import { DataSource } from "typeorm";
import { Grant } from "./entities/Grant";
import { MilestoneProof } from "./entities/MilestoneProof";
import { User } from "./entities/User";
import { buildUserRouter } from "./routes/users";
import { GrantReviewer } from "./entities/GrantReviewer";
import { buildGrantReviewerRouter } from "./routes/grant-reviewers";
import { MilestoneApproval } from "./entities/MilestoneApproval";
import { buildMilestoneApprovalRouter } from "./routes/milestone-approvals";
 import { buildMilestoneApprovalNotifyRouter } from "./routes/milestone-approvals-notify";
import { buildGrantRouter } from "./routes/grants";
import { buildMilestoneProofRouter } from "./routes/milestone-proof";
import { GrantSyncService } from "./services/grant-sync-service";
import { SignatureService } from "./services/signature-service";
import { SorobanContractClient } from "./soroban/types";
import { createRateLimiter } from "./middlewares/rate-limiter";

export const createApp = (dataSource: DataSource, sorobanClient: SorobanContractClient) => {
  const app = express();
  app.use(helmet());
  app.use(express.json());

  const rateLimiter = createRateLimiter(dataSource);
  

  const grantRepo = dataSource.getRepository(Grant);
  const proofRepo = dataSource.getRepository(MilestoneProof);
  const userRepo = dataSource.getRepository(User);
  const grantReviewerRepo = dataSource.getRepository(GrantReviewer);
  const milestoneApprovalRepo = dataSource.getRepository(MilestoneApproval);
  const grantSyncService = new GrantSyncService(dataSource, sorobanClient);
  const signatureService = new SignatureService();

  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(rateLimiter);
  app.use("/grants", buildGrantRouter(grantRepo, grantSyncService));
  app.use("/milestone_proof", buildMilestoneProofRouter(proofRepo, signatureService, grantRepo, userRepo));
  app.use("/users", buildUserRouter(userRepo));
  app.use("/grant_reviewers", buildGrantReviewerRouter(grantReviewerRepo));
  app.use("/milestone_approvals", buildMilestoneApprovalRouter(milestoneApprovalRepo));
   app.use("/milestone_approvals_notify", buildMilestoneApprovalNotifyRouter(milestoneApprovalRepo, grantRepo, userRepo));

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Internal server error";
    res.status(500).json({ error: message });
  });

  return app;
};
