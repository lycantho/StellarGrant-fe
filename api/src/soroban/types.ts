export type SorobanGrant = {
  id: number;
  title: string;
  status: string;
  recipient: string;
  totalAmount: string;
  /** Comma-separated tag string, e.g. "web3,climate,open-source" */
  tags?: string | null;
  localizedMetadata?: Record<string, { title?: string; description?: string }> | null;
};

export type ContributorScore = {
  address: string;
  reputation: number;
  totalEarned: string;
};

export interface SorobanContractClient {
  fetchGrants(): Promise<SorobanGrant[]>;
  fetchGrantById(id: number): Promise<SorobanGrant | null>;
  fetchContributorScore(address: string): Promise<ContributorScore | null>;
}
