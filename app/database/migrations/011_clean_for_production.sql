-- ============================================
-- CLEAN DATABASE FOR PRODUCTION/REAL EXPERIMENTS
-- ============================================
-- This migration removes all fake/seed data while preserving:
-- - Database schema and structure
-- - Agent definitions
-- - Workflow definitions
-- - Scheduled workflows (if any)
--
-- Run this ONCE before starting real experiments
-- WARNING: This will DELETE all existing data!

-- ============================================
-- REMOVE EXECUTION HISTORY
-- ============================================

-- Remove all agent executions
DELETE FROM agent_executions WHERE id IS NOT NULL;

-- Remove all schedule executions
DELETE FROM schedule_executions WHERE id IS NOT NULL;

-- Remove all conversation messages
DELETE FROM conversation_messages WHERE id IS NOT NULL;

-- Remove all workflow checkpoints
DELETE FROM workflow_checkpoints WHERE id IS NOT NULL;

-- Remove all workflow executions
DELETE FROM workflow_executions WHERE id IS NOT NULL;

-- Remove all events
DELETE FROM events WHERE id IS NOT NULL;

-- ============================================
-- REMOVE TRADING DATA
-- ============================================

-- Remove all trading decisions
DELETE FROM trading_decisions WHERE id IS NOT NULL;

-- Remove all orders
DELETE FROM orders WHERE id IS NOT NULL;

-- Remove all portfolio positions
DELETE FROM portfolio WHERE id IS NOT NULL;

-- ============================================
-- REMOVE MARKET DATA
-- ============================================

-- Remove all market data cache
DELETE FROM market_data WHERE id IS NOT NULL;

-- Remove all historical data
DELETE FROM historical_data WHERE id IS NOT NULL;

-- Remove all news articles
DELETE FROM news_articles WHERE id IS NOT NULL;

-- Remove all social mentions
DELETE FROM social_mentions WHERE id IS NOT NULL;

-- ============================================
-- REMOVE MEMORIES
-- ============================================

-- Remove all memories (long-term memory store)
DELETE FROM memories WHERE id IS NOT NULL;

-- ============================================
-- RESET ACCOUNT
-- ============================================

-- Reset account to default starting state
UPDATE accounts 
SET 
    cash = 100000.00,
    total_value = 100000.00,
    total_pnl = 0.00,
    total_pnl_percent = 0.00,
    mode = 'paper',
    updated_at = NOW()
WHERE name = 'default';

-- If no default account exists, create one
INSERT INTO accounts (name, cash, total_value, total_pnl, total_pnl_percent, mode)
SELECT 'default', 100000.00, 100000.00, 0.00, 0.00, 'paper'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'default');

-- ============================================
-- OPTIONAL: CLEAR SCHEDULED WORKFLOWS
-- ============================================
-- Uncomment the lines below if you want to remove scheduled workflows too

-- DELETE FROM scheduled_workflows WHERE id IS NOT NULL;

-- ============================================
-- VACUUM AND ANALYZE
-- ============================================
-- Note: VACUUM cannot run inside a transaction block
-- Run manually after migration if needed: VACUUM ANALYZE;

-- ============================================
-- VERIFICATION
-- ============================================

SELECT 
    'Database cleaned successfully!' as status,
    NOW() as cleaned_at,
    (SELECT COUNT(*) FROM agents) as agents_preserved,
    (SELECT COUNT(*) FROM workflows) as workflows_preserved,
    (SELECT COUNT(*) FROM scheduled_workflows) as schedules_preserved,
    (SELECT cash FROM accounts WHERE name = 'default') as starting_cash,
    (SELECT COUNT(*) FROM market_data) as market_data_rows,
    (SELECT COUNT(*) FROM news_articles) as news_rows,
    (SELECT COUNT(*) FROM portfolio) as positions,
    (SELECT COUNT(*) FROM trading_decisions) as decisions,
    (SELECT COUNT(*) FROM memories) as memories;
