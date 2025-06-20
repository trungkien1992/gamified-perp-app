# 🚨 Emergency Procedures

## Trading Halted
```bash
# 1. Enable maintenance mode
kubectl set env deployment/backend MAINTENANCE_MODE=true

# 2. Notify users
curl -X POST $WEBHOOK_URL -d '{"message": "Trading temporarily paused"}'

# 3. Investigate issue
kubectl logs -f deployment/backend --tail=100

# 4. Resume trading
kubectl set env deployment/backend MAINTENANCE_MODE=false
```

## Database Overload
```sql
-- Kill long-running queries
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE query_time > interval '5 minutes';

-- Analyze slow queries
SELECT query, calls, mean_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
```

## Smart Contract Issues
```bash
# Pause contract (if admin)
starkli invoke $CONTRACT_ADDRESS pause_contract \
  --account $ADMIN_ACCOUNT

# Deploy fix
starkli deploy $NEW_CONTRACT \
  --account $DEPLOYER_ACCOUNT

# Update backend config
kubectl set env deployment/backend \
  XP_CONTRACT_ADDRESS=$NEW_CONTRACT
```
