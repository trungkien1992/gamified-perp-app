#[cfg(test)]
mod tests {
    use starknet::testing::{set_caller_address, set_block_timestamp};
    use starknet::{ContractAddress, contract_address_const};
    use xp_system::{XPSystem, IXPSystemDispatcher, IXPSystemDispatcherTrait};
    
    fn setup() -> (IXPSystemDispatcher, ContractAddress, ContractAddress) {
        let admin = contract_address_const::<0x123>();
        let backend = contract_address_const::<0x456>();
        let user = contract_address_const::<0x789>();
        
        let contract = XPSystem::deploy(admin, backend);
        let dispatcher = IXPSystemDispatcher { contract_address: contract };
        
        (dispatcher, admin, user)
    }
    
    #[test]
    fn test_award_xp_success() {
        let (dispatcher, admin, user) = setup();
        
        // Set caller as backend
        set_caller_address(contract_address_const::<0x456>());
        
        // Award XP
        dispatcher.award_xp(user, 'first_trade', 100);
        
        // Check XP balance
        let xp = dispatcher.get_user_xp(user);
        assert(xp == 100, 'XP should be 100');
        
        // Check level
        let level = dispatcher.get_user_level(user);
        assert(level == 2, 'Should be level 2');
    }
    
    #[test]
    #[should_panic(expected: ('Action on cooldown',))]
    fn test_cooldown_enforcement() {
        let (dispatcher, _, user) = setup();
        set_caller_address(contract_address_const::<0x456>());
        
        // Award XP first time
        dispatcher.award_xp(user, 'daily_login', 5);
        
        // Try again immediately (should fail)
        dispatcher.award_xp(user, 'daily_login', 5);
    }
    
    #[test]
    fn test_batch_xp_award() {
        let (dispatcher, _, _) = setup();
        set_caller_address(contract_address_const::<0x456>());
        
        let updates = array![
            PendingXPUpdate {
                user: contract_address_const::<0x111>(),
                amount: 50,
                action_type: 'trade_executed',
                timestamp: 1000,
            },
            PendingXPUpdate {
                user: contract_address_const::<0x222>(),
                amount: 100,
                action_type: 'first_trade',
                timestamp: 1001,
            },
        ];
        
        dispatcher.batch_award_xp(updates);
        
        // Verify both users received XP
        assert(dispatcher.get_user_xp(contract_address_const::<0x111>()) == 50, 'User 1 XP wrong');
        assert(dispatcher.get_user_xp(contract_address_const::<0x222>()) == 100, 'User 2 XP wrong');
    }
} 