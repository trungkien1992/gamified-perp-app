#[starknet::contract]
mod XPSystem {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess, 
        Map, StorageMapReadAccess, StorageMapWriteAccess
    };
    use core::array::ArrayTrait;
    use core::option::OptionTrait;
    use core::traits::TryInto;

    #[storage]
    struct Storage {
        // User XP balances
        user_xp: Map<ContractAddress, u256>,
        // User levels
        user_level: Map<ContractAddress, u8>,
        // Action multipliers (action_type -> multiplier)
        action_multipliers: Map<felt252, u8>,
        // Cooldowns (user -> action -> timestamp)
        user_action_cooldowns: Map<(ContractAddress, felt252), u64>,
        // Daily action counts
        user_daily_actions: Map<(ContractAddress, felt252, u64), u8>,
        // Admin address
        admin: ContractAddress,
        // Authorized backend address
        backend_address: ContractAddress,
        // Pending XP updates (for batch processing)
        pending_xp_updates: Map<u32, PendingXPUpdate>,
        pending_updates_count: u32,
        // Level thresholds
        level_thresholds: Map<u8, u256>,
        // Contract pause state
        is_paused: bool,
    }

    #[derive(Drop, Serde, starknet::Store)]
    struct PendingXPUpdate {
        user: ContractAddress,
        amount: u256,
        action_type: felt252,
        timestamp: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        XPAwarded: XPAwarded,
        LevelUp: LevelUp,
        BatchXPProcessed: BatchXPProcessed,
        MultiplierUpdated: MultiplierUpdated,
        ContractPaused: ContractPaused,
        ContractUnpaused: ContractUnpaused,
    }

    #[derive(Drop, starknet::Event)]
    struct XPAwarded {
        user: ContractAddress,
        amount: u256,
        action_type: felt252,
        new_total: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct LevelUp {
        user: ContractAddress,
        old_level: u8,
        new_level: u8,
        total_xp: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct BatchXPProcessed {
        count: u32,
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct MultiplierUpdated {
        action_type: felt252,
        new_multiplier: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct ContractPaused {
        timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct ContractUnpaused {
        timestamp: u64,
    }

    // Errors
    mod Errors {
        const UNAUTHORIZED: felt252 = 'Unauthorized caller';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const INVALID_ACTION: felt252 = 'Invalid action type';
        const ON_COOLDOWN: felt252 = 'Action on cooldown';
        const DAILY_LIMIT_REACHED: felt252 = 'Daily limit reached';
        const INVALID_AMOUNT: felt252 = 'Invalid XP amount';
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        backend_address: ContractAddress,
    ) {
        self.admin.write(admin);
        self.backend_address.write(backend_address);
        self.is_paused.write(false);
        
        // Initialize level thresholds
        self.level_thresholds.write(1, 0);
        self.level_thresholds.write(2, 100);
        self.level_thresholds.write(3, 300);
        self.level_thresholds.write(4, 600);
        self.level_thresholds.write(5, 1000);
        self.level_thresholds.write(6, 1600);
        self.level_thresholds.write(7, 2500);
        self.level_thresholds.write(8, 4000);
        self.level_thresholds.write(9, 6000);
        self.level_thresholds.write(10, 10000);
        
        // Initialize default action multipliers
        self.action_multipliers.write('first_trade', 1);
        self.action_multipliers.write('trade_executed', 1);
        self.action_multipliers.write('profitable_trade', 1);
        self.action_multipliers.write('daily_login', 1);
        self.action_multipliers.write('referral', 2);
    }

    #[external(v0)]
    impl XPSystemImpl of IXPSystem {
        fn award_xp(
            ref self: ContractState,
            user: ContractAddress,
            action_type: felt252,
            base_amount: u256,
        ) {
            // Check authorization
            let caller = get_caller_address();
            assert(
                caller == self.admin.read() || caller == self.backend_address.read(),
                Errors::UNAUTHORIZED
            );
            
            // Check if paused
            assert(!self.is_paused.read(), Errors::CONTRACT_PAUSED);
            
            // Check cooldown
            let current_time = get_block_timestamp();
            let cooldown_key = (user, action_type);
            let last_action_time = self.user_action_cooldowns.read(cooldown_key);
            
            // Simple cooldown check (can be enhanced with action-specific cooldowns)
            if last_action_time > 0 {
                assert(current_time >= last_action_time + 60, Errors::ON_COOLDOWN);
            }
            
            // Calculate final XP amount with multiplier
            let multiplier = self.action_multipliers.read(action_type);
            let final_amount = base_amount * multiplier.into();
            
            // Update user XP
            let current_xp = self.user_xp.read(user);
            let new_xp = current_xp + final_amount;
            self.user_xp.write(user, new_xp);
            
            // Update cooldown
            self.user_action_cooldowns.write(cooldown_key, current_time);
            
            // Check for level up
            self._check_level_up(user, new_xp);
            
            // Emit event
            self.emit(XPAwarded {
                user,
                amount: final_amount,
                action_type,
                new_total: new_xp,
            });
        }

        fn batch_award_xp(
            ref self: ContractState,
            updates: Array<PendingXPUpdate>,
        ) {
            // Only backend can batch update
            assert(get_caller_address() == self.backend_address.read(), Errors::UNAUTHORIZED);
            assert(!self.is_paused.read(), Errors::CONTRACT_PAUSED);
            
            let mut count: u32 = 0;
            let updates_len = updates.len();
            
            loop {
                if count >= updates_len {
                    break;
                }
                
                let update = updates.get(count).unwrap().unbox();
                
                // Process each update
                let current_xp = self.user_xp.read(update.user);
                let new_xp = current_xp + update.amount;
                self.user_xp.write(update.user, new_xp);
                
                // Check for level up
                self._check_level_up(update.user, new_xp);
                
                // Emit individual event
                self.emit(XPAwarded {
                    user: update.user,
                    amount: update.amount,
                    action_type: update.action_type,
                    new_total: new_xp,
                });
                
                count += 1;
            };
            
            // Emit batch event
            self.emit(BatchXPProcessed {
                count,
                timestamp: get_block_timestamp(),
            });
        }

        fn get_user_xp(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_xp.read(user)
        }

        fn get_user_level(self: @ContractState, user: ContractAddress) -> u8 {
            self.user_level.read(user)
        }

        fn get_level_threshold(self: @ContractState, level: u8) -> u256 {
            self.level_thresholds.read(level)
        }

        fn set_action_multiplier(
            ref self: ContractState,
            action_type: felt252,
            multiplier: u8,
        ) {
            assert(get_caller_address() == self.admin.read(), Errors::UNAUTHORIZED);
            
            self.action_multipliers.write(action_type, multiplier);
            
            self.emit(MultiplierUpdated {
                action_type,
                new_multiplier: multiplier,
            });
        }

        fn pause_contract(ref self: ContractState) {
            assert(get_caller_address() == self.admin.read(), Errors::UNAUTHORIZED);
            
            self.is_paused.write(true);
            
            self.emit(ContractPaused {
                timestamp: get_block_timestamp(),
            });
        }

        fn unpause_contract(ref self: ContractState) {
            assert(get_caller_address() == self.admin.read(), Errors::UNAUTHORIZED);
            
            self.is_paused.write(false);
            
            self.emit(ContractUnpaused {
                timestamp: get_block_timestamp(),
            });
        }

        fn update_backend_address(
            ref self: ContractState,
            new_backend: ContractAddress,
        ) {
            assert(get_caller_address() == self.admin.read(), Errors::UNAUTHORIZED);
            
            self.backend_address.write(new_backend);
        }
    }

    #[generate_trait]
    impl InternalFunctions of InternalFunctionsTrait {
        fn _check_level_up(
            ref self: ContractState,
            user: ContractAddress,
            total_xp: u256,
        ) {
            let current_level = self.user_level.read(user);
            let mut new_level = current_level;
            
            // Check each level threshold
            let mut level: u8 = 10;
            loop {
                if level == 0 {
                    break;
                }
                
                let threshold = self.level_thresholds.read(level);
                if total_xp >= threshold && level > new_level {
                    new_level = level;
                    break;
                }
                
                level -= 1;
            };
            
            // Update level if changed
            if new_level > current_level {
                self.user_level.write(user, new_level);
                
                self.emit(LevelUp {
                    user,
                    old_level: current_level,
                    new_level,
                    total_xp,
                });
            }
        }
    }
}