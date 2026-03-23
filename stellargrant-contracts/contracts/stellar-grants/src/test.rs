#[cfg(test)]
mod tests {
    use crate::storage::Storage;
    use crate::types::{ContractError, Grant, Milestone, MilestoneState};
    use crate::StellarGrantsContract;
    use crate::StellarGrantsContractClient;
    use soroban_sdk::{testutils::Address as _, Address, Env, Map, Vec};

    fn setup_test(
        env: &Env,
    ) -> (
        StellarGrantsContractClient<'_>,
        Address,
        soroban_sdk::Address,
    ) {
        let contract_id = env.register(StellarGrantsContract, ());
        let client = StellarGrantsContractClient::new(env, &contract_id);
        let admin = Address::generate(env);
        (client, admin, contract_id)
    }

    fn create_grant(
        env: &Env,
        contract_id: &soroban_sdk::Address,
        grant_id: u64,
        reviewers: Vec<Address>,
    ) {
        env.as_contract(contract_id, || {
            let grant = Grant {
                id: grant_id,
                reviewers,
                total_milestones: 1,
            };
            Storage::set_grant(env, grant_id, &grant);
        });
    }

    fn create_milestone(
        env: &Env,
        contract_id: &soroban_sdk::Address,
        grant_id: u64,
        milestone_idx: u32,
        state: MilestoneState,
    ) {
        env.as_contract(contract_id, || {
            let milestone = Milestone {
                state,
                votes: Map::new(env),
                approvals: 0,
                rejections: 0,
                reasons: Map::new(env),
                status_updated_at: 0,
            };
            Storage::set_milestone(env, grant_id, milestone_idx, &milestone);
        });
    }

    #[test]
    fn test_successful_vote() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer = Address::generate(&env);

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();
        let result = client.milestone_vote(&grant_id, &milestone_idx, &reviewer, &true);

        assert_eq!(result, true); // Quorum reached (1/1)

        env.as_contract(&contract_id, || {
            let updated_milestone = Storage::get_milestone(&env, grant_id, milestone_idx).unwrap();
            assert_eq!(updated_milestone.approvals, 1);
            assert_eq!(updated_milestone.state, MilestoneState::Approved);
            assert!(updated_milestone.votes.get(reviewer).unwrap());
        });
    }

    #[test]
    fn test_successful_rejection() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer = Address::generate(&env);
        let reason = soroban_sdk::String::from_str(&env, "Incomplete results");

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();
        let result = client.milestone_reject(&grant_id, &milestone_idx, &reviewer, &reason);

        assert_eq!(result, true); // Majority reached (1/1)

        env.as_contract(&contract_id, || {
            let updated_milestone = Storage::get_milestone(&env, grant_id, milestone_idx).unwrap();
            assert_eq!(updated_milestone.rejections, 1);
            assert_eq!(updated_milestone.state, MilestoneState::Rejected);
            assert_eq!(updated_milestone.reasons.get(reviewer).unwrap(), reason);
        });
    }

    #[test]
    fn test_majority_rejection() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer1 = Address::generate(&env);
        let reviewer2 = Address::generate(&env);
        let reason1 = soroban_sdk::String::from_str(&env, "Reason 1");
        let reason2 = soroban_sdk::String::from_str(&env, "Reason 2");

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer1.clone());
        reviewers.push_back(reviewer2.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();

        // First rejection - 1/2
        let result1 = client.milestone_reject(&grant_id, &milestone_idx, &reviewer1, &reason1);
        assert_eq!(result1, false);

        // Second rejection - 2/2 (majority reached)
        let result2 = client.milestone_reject(&grant_id, &milestone_idx, &reviewer2, &reason2);
        assert_eq!(result2, true);

        env.as_contract(&contract_id, || {
            let updated_milestone = Storage::get_milestone(&env, grant_id, milestone_idx).unwrap();
            assert_eq!(updated_milestone.state, MilestoneState::Rejected);
            assert_eq!(updated_milestone.reasons.get(reviewer1).unwrap(), reason1);
            assert_eq!(updated_milestone.reasons.get(reviewer2).unwrap(), reason2);
        });
    }

    #[test]
    fn test_unauthorized_reviewer() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer = Address::generate(&env);
        let unauthorized_user = Address::generate(&env);

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();
        let result =
            client.try_milestone_vote(&grant_id, &milestone_idx, &unauthorized_user, &true);

        assert_eq!(result, Err(Ok(ContractError::Unauthorized.into())));
    }

    #[test]
    fn test_double_voting_prevention() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer = Address::generate(&env);
        let other_reviewer = Address::generate(&env);
        let reason = soroban_sdk::String::from_str(&env, "Reason");

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer.clone());
        reviewers.push_back(other_reviewer.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();
        client.milestone_vote(&grant_id, &milestone_idx, &reviewer, &true);
        let result = client.try_milestone_reject(&grant_id, &milestone_idx, &reviewer, &reason);

        assert_eq!(result, Err(Ok(ContractError::AlreadyVoted.into())));
    }

    #[test]
    fn test_milestone_not_submitted() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer = Address::generate(&env);
        let reason = soroban_sdk::String::from_str(&env, "Reason");

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        // Milestone in Pending state
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Pending,
        );

        env.mock_all_auths();
        let result = client.try_milestone_reject(&grant_id, &milestone_idx, &reviewer, &reason);

        assert_eq!(result, Err(Ok(ContractError::MilestoneNotSubmitted.into())));
    }

    #[test]
    fn test_quorum_calculation_even_reviewers() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer1 = Address::generate(&env);
        let reviewer2 = Address::generate(&env);

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer1.clone());
        reviewers.push_back(reviewer2.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();

        // First vote - quorum not reached (1/2)
        let result1 = client.milestone_vote(&grant_id, &milestone_idx, &reviewer1, &true);
        assert_eq!(result1, false);

        // Second vote - quorum reached (2/2)
        let result2 = client.milestone_vote(&grant_id, &milestone_idx, &reviewer2, &true);
        assert_eq!(result2, true);

        env.as_contract(&contract_id, || {
            let updated_milestone = Storage::get_milestone(&env, grant_id, milestone_idx).unwrap();
            assert_eq!(updated_milestone.state, MilestoneState::Approved);
        });
    }

    #[test]
    fn test_quorum_calculation_odd_reviewers() {
        let env = Env::default();
        let (client, _, contract_id) = setup_test(&env);
        let grant_id = 1;
        let milestone_idx = 0;
        let reviewer1 = Address::generate(&env);
        let reviewer2 = Address::generate(&env);
        let reviewer3 = Address::generate(&env);

        let mut reviewers = Vec::new(&env);
        reviewers.push_back(reviewer1.clone());
        reviewers.push_back(reviewer2.clone());
        reviewers.push_back(reviewer3.clone());
        create_grant(&env, &contract_id, grant_id, reviewers);
        create_milestone(
            &env,
            &contract_id,
            grant_id,
            milestone_idx,
            MilestoneState::Submitted,
        );

        env.mock_all_auths();

        // First vote - 1/3
        assert_eq!(
            client.milestone_vote(&grant_id, &milestone_idx, &reviewer1, &true),
            false
        );

        // Second vote - 2/3 (quorum reached: 3/2 + 1 = 1 + 1 = 2)
        assert_eq!(
            client.milestone_vote(&grant_id, &milestone_idx, &reviewer2, &true),
            true
        );

        env.as_contract(&contract_id, || {
            let updated_milestone = Storage::get_milestone(&env, grant_id, milestone_idx).unwrap();
            assert_eq!(updated_milestone.state, MilestoneState::Approved);
        });
    }
}
