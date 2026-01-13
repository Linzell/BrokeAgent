-- ============================================
-- SEED DEFAULT SCHEDULES
-- ============================================
-- Creates default scheduled workflows based on trading best practices
-- All schedules are ENABLED by default for immediate use.

-- Default symbols for schedules (tech-focused watchlist)
-- You can update these after creation via the API or frontend

-- ============================================
-- PRE-MARKET NEWS SCAN (7:00 AM ET, Mon-Fri)
-- ============================================
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Pre-Market News Scan',
    'Gather overnight news, earnings, and pre-market movers at 7:00 AM ET',
    'cron',
    '{"type": "cron", "expression": "0 7 * * 1-5"}'::jsonb,
    '{"type": "research", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['pre-market', 'news', 'daily']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Pre-Market News Scan'
);

-- ============================================
-- MARKET OPEN ANALYSIS (9:35 AM ET, Mon-Fri)
-- ============================================
-- Uses 'decision' workflow to generate actual trading decisions
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Market Open Analysis',
    'Analyze opening moves and make trading decisions 5 minutes after market open',
    'cron',
    '{"type": "cron", "expression": "35 9 * * 1-5"}'::jsonb,
    '{"type": "decision", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['market-open', 'analysis', 'daily', 'trading']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Market Open Analysis'
);

-- ============================================
-- LATE MORNING TRADING (11:00 AM ET, Mon-Fri)
-- ============================================
-- Catches mid-morning reversals after opening volatility settles
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Late Morning Trading',
    'Trading decisions after opening volatility settles - catches reversals',
    'cron',
    '{"type": "cron", "expression": "0 11 * * 1-5"}'::jsonb,
    '{"type": "decision", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['late-morning', 'trading', 'daily']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Late Morning Trading'
);

-- ============================================
-- EARLY AFTERNOON TRADING (1:00 PM ET, Mon-Fri)
-- ============================================
-- Post-lunch session - often sees renewed momentum
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Early Afternoon Trading',
    'Trading decisions for post-lunch session momentum',
    'cron',
    '{"type": "cron", "expression": "0 13 * * 1-5"}'::jsonb,
    '{"type": "decision", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['afternoon', 'trading', 'daily']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Early Afternoon Trading'
);

-- ============================================
-- PRE-CLOSE ANALYSIS (3:30 PM ET, Mon-Fri)
-- ============================================
-- Uses 'decision' workflow to make end-of-day trading decisions
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Pre-Close Analysis',
    'Final analysis and trading decisions before market close',
    'cron',
    '{"type": "cron", "expression": "30 15 * * 1-5"}'::jsonb,
    '{"type": "decision", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['pre-close', 'analysis', 'daily', 'trading']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Pre-Close Analysis'
);

-- ============================================
-- AFTER-HOURS SCAN (4:30 PM ET, Mon-Fri)
-- ============================================
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'After-Hours Scan',
    'Catch after-hours earnings announcements and breaking news',
    'cron',
    '{"type": "cron", "expression": "30 16 * * 1-5"}'::jsonb,
    '{"type": "research", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA", "AMZN", "META"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['after-hours', 'earnings', 'news', 'daily']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'After-Hours Scan'
);

-- ============================================
-- WEEKEND PORTFOLIO REVIEW (Saturday 10:00 AM ET)
-- ============================================
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Weekend Portfolio Review',
    'Weekly comprehensive portfolio analysis and rebalancing suggestions',
    'cron',
    '{"type": "cron", "expression": "0 10 * * 6"}'::jsonb,
    '{"type": "debate", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA", "AMZN", "META", "SPY", "QQQ"]}'::jsonb,
    true, -- Enabled by default
    1,
    true,
    ARRAY['weekend', 'review', 'weekly']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Weekend Portfolio Review'
);

-- ============================================
-- VOLATILITY EVENT TRIGGER
-- ============================================
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Volatility Spike Response',
    'Triggered when market volatility spikes - analyzes impact on holdings',
    'event',
    '{"type": "event", "eventType": "volatility_spike"}'::jsonb,
    '{"type": "debate", "symbols": ["SPY", "QQQ", "VIX"]}'::jsonb,
    true, -- Enabled by default
    2, -- Allow 2 concurrent for fast response
    true,
    ARRAY['event', 'volatility', 'reactive']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Volatility Spike Response'
);

-- ============================================
-- EARNINGS EVENT TRIGGER
-- ============================================
INSERT INTO scheduled_workflows (
    id, name, description, trigger_type, trigger_config, 
    request, enabled, max_concurrent, retry_on_fail, tags
)
SELECT 
    uuid_generate_v4(),
    'Earnings Report Response',
    'Triggered when earnings are released for watched symbols',
    'event',
    '{"type": "event", "eventType": "earnings_release"}'::jsonb,
    '{"type": "research", "symbols": ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA"]}'::jsonb,
    true, -- Enabled by default
    3, -- Allow multiple concurrent for batch earnings
    true,
    ARRAY['event', 'earnings', 'reactive']
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_workflows WHERE name = 'Earnings Report Response'
);

-- ============================================
-- VERIFICATION
-- ============================================
SELECT 
    'Default schedules seeded!' as status,
    COUNT(*) as total_schedules,
    COUNT(*) FILTER (WHERE enabled = true) as enabled_schedules,
    COUNT(*) FILTER (WHERE trigger_type = 'cron') as cron_schedules,
    COUNT(*) FILTER (WHERE trigger_type = 'event') as event_schedules
FROM scheduled_workflows;
