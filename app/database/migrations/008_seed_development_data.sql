-- ============================================
-- SEED DEVELOPMENT DATA
-- ============================================
-- Run this to populate the database with sample data for development

-- Clear existing seed data (keeping agents and workflows)
DELETE FROM trading_decisions WHERE id IS NOT NULL;
DELETE FROM orders WHERE id IS NOT NULL;
DELETE FROM portfolio WHERE id IS NOT NULL;
DELETE FROM news_articles WHERE id IS NOT NULL;
DELETE FROM social_mentions WHERE id IS NOT NULL;
DELETE FROM market_data WHERE id IS NOT NULL;

-- Reset account to default state
UPDATE accounts SET cash = 85000, total_value = 115000, total_pnl = 15000, total_pnl_percent = 15 WHERE name = 'default';

-- ============================================
-- MARKET DATA
-- ============================================

-- Insert recent market data for common symbols
INSERT INTO market_data (symbol, price, open_price, high, low, previous_close, change, change_percent, volume, market_cap, pe_ratio, quote_time) VALUES
-- Apple
('AAPL', 195.50, 193.00, 196.25, 192.50, 193.25, 2.25, 1.16, 58500000, 3050000000000, 31.5, NOW() - INTERVAL '1 minute'),
('AAPL', 194.75, 194.00, 195.00, 193.50, 193.25, 1.50, 0.78, 45000000, 3050000000000, 31.5, NOW() - INTERVAL '1 hour'),
('AAPL', 193.25, 192.00, 194.00, 191.50, 192.50, 0.75, 0.39, 52000000, 3050000000000, 31.5, NOW() - INTERVAL '1 day'),
-- Microsoft
('MSFT', 425.80, 420.00, 427.50, 418.25, 421.00, 4.80, 1.14, 25000000, 3150000000000, 35.2, NOW() - INTERVAL '1 minute'),
('MSFT', 423.50, 422.00, 424.00, 420.50, 421.00, 2.50, 0.59, 20000000, 3150000000000, 35.2, NOW() - INTERVAL '1 hour'),
('MSFT', 421.00, 419.00, 422.50, 417.00, 418.00, 3.00, 0.72, 22000000, 3150000000000, 35.2, NOW() - INTERVAL '1 day'),
-- Google
('GOOGL', 175.25, 172.50, 176.00, 171.75, 173.00, 2.25, 1.30, 28000000, 2200000000000, 25.8, NOW() - INTERVAL '1 minute'),
('GOOGL', 174.00, 173.25, 174.50, 172.00, 173.00, 1.00, 0.58, 22000000, 2200000000000, 25.8, NOW() - INTERVAL '1 hour'),
('GOOGL', 173.00, 170.50, 173.75, 169.50, 171.25, 1.75, 1.02, 30000000, 2200000000000, 25.8, NOW() - INTERVAL '1 day'),
-- NVIDIA
('NVDA', 142.50, 138.00, 144.00, 137.25, 139.75, 2.75, 1.97, 85000000, 3500000000000, 65.0, NOW() - INTERVAL '1 minute'),
('NVDA', 140.25, 139.00, 141.00, 138.00, 139.75, 0.50, 0.36, 70000000, 3500000000000, 65.0, NOW() - INTERVAL '1 hour'),
('NVDA', 139.75, 135.00, 140.50, 134.00, 136.50, 3.25, 2.38, 90000000, 3500000000000, 65.0, NOW() - INTERVAL '1 day'),
-- Tesla
('TSLA', 245.75, 240.00, 248.00, 238.50, 242.00, 3.75, 1.55, 95000000, 780000000000, 75.0, NOW() - INTERVAL '1 minute'),
('TSLA', 243.00, 241.50, 244.00, 240.00, 242.00, 1.00, 0.41, 75000000, 780000000000, 75.0, NOW() - INTERVAL '1 hour'),
('TSLA', 242.00, 235.00, 243.50, 233.00, 238.00, 4.00, 1.68, 110000000, 780000000000, 75.0, NOW() - INTERVAL '1 day'),
-- Amazon
('AMZN', 185.50, 182.00, 186.75, 181.25, 183.00, 2.50, 1.37, 42000000, 1950000000000, 42.5, NOW() - INTERVAL '1 minute'),
('AMZN', 184.00, 183.50, 184.75, 182.50, 183.00, 1.00, 0.55, 35000000, 1950000000000, 42.5, NOW() - INTERVAL '1 hour'),
('AMZN', 183.00, 180.00, 183.50, 178.50, 181.00, 2.00, 1.10, 45000000, 1950000000000, 42.5, NOW() - INTERVAL '1 day');

-- ============================================
-- PORTFOLIO POSITIONS
-- ============================================

INSERT INTO portfolio (symbol, quantity, avg_cost, current_price, market_value, unrealized_pnl, unrealized_pnl_percent, sector, first_bought_at, last_trade_at) VALUES
('AAPL', 50, 180.50, 195.50, 9775.00, 750.00, 8.31, 'Technology', NOW() - INTERVAL '30 days', NOW() - INTERVAL '5 days'),
('MSFT', 25, 400.00, 425.80, 10645.00, 645.00, 6.45, 'Technology', NOW() - INTERVAL '45 days', NOW() - INTERVAL '10 days'),
('NVDA', 35, 125.00, 142.50, 4987.50, 612.50, 14.00, 'Technology', NOW() - INTERVAL '60 days', NOW() - INTERVAL '3 days'),
('GOOGL', 40, 165.00, 175.25, 7010.00, 410.00, 6.21, 'Technology', NOW() - INTERVAL '20 days', NOW() - INTERVAL '7 days');

-- ============================================
-- NEWS ARTICLES
-- ============================================

INSERT INTO news_articles (headline, summary, source, symbols, sentiment_score, sentiment_label, published_at) VALUES
('Apple Reports Record Q4 Revenue, Beats Analyst Expectations', 'Apple Inc. announced record-breaking fourth quarter results, with revenue surpassing analyst expectations by 5%. iPhone sales remained strong despite economic headwinds.', 'Reuters', ARRAY['AAPL'], 0.85, 'bullish', NOW() - INTERVAL '2 hours'),
('Microsoft Azure Growth Accelerates Amid AI Boom', 'Microsoft''s cloud computing platform Azure reported 29% year-over-year growth, driven by increased demand for AI services and enterprise cloud adoption.', 'Bloomberg', ARRAY['MSFT'], 0.78, 'bullish', NOW() - INTERVAL '4 hours'),
('NVIDIA Secures Major AI Chip Contract with Leading Cloud Provider', 'NVIDIA has secured a multi-billion dollar contract to supply next-generation AI chips to a major cloud computing provider, further cementing its dominance in the AI hardware market.', 'CNBC', ARRAY['NVDA'], 0.92, 'very_bullish', NOW() - INTERVAL '6 hours'),
('Tesla Announces New Gigafactory Location in Southeast Asia', 'Tesla Inc. revealed plans for a new manufacturing facility in Vietnam, aiming to tap into growing EV demand in the region and reduce production costs.', 'Reuters', ARRAY['TSLA'], 0.65, 'bullish', NOW() - INTERVAL '8 hours'),
('Google DeepMind Achieves Breakthrough in Medical AI Diagnosis', 'Alphabet''s DeepMind research lab announced a significant breakthrough in AI-assisted medical diagnosis, with accuracy rates surpassing human specialists in multiple conditions.', 'TechCrunch', ARRAY['GOOGL'], 0.72, 'bullish', NOW() - INTERVAL '10 hours'),
('Amazon AWS Introduces New Cost Optimization Tools', 'Amazon Web Services launched new suite of tools designed to help enterprises reduce cloud spending by up to 30% while maintaining performance.', 'ZDNet', ARRAY['AMZN'], 0.55, 'neutral', NOW() - INTERVAL '12 hours'),
('Fed Signals Cautious Approach to Rate Cuts in 2025', 'Federal Reserve officials indicated a more measured approach to interest rate reductions, citing persistent inflation concerns in certain sectors of the economy.', 'WSJ', ARRAY['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA', 'AMZN'], -0.25, 'bearish', NOW() - INTERVAL '14 hours'),
('Tech Sector Rallies on Strong Earnings Reports', 'Major technology stocks gained significantly as the sector continues to post strong earnings results, led by semiconductor and cloud computing companies.', 'MarketWatch', ARRAY['AAPL', 'MSFT', 'NVDA', 'GOOGL'], 0.68, 'bullish', NOW() - INTERVAL '18 hours'),
('Analysts Upgrade NVIDIA Price Target to $200', 'Several major Wall Street analysts raised their price targets for NVIDIA following impressive quarterly results and optimistic AI demand forecasts.', 'Barrons', ARRAY['NVDA'], 0.88, 'very_bullish', NOW() - INTERVAL '1 day'),
('Apple Vision Pro Sales Miss Initial Expectations', 'Apple''s Vision Pro headset has reportedly fallen short of initial sales projections, though the company remains optimistic about long-term potential of the spatial computing market.', 'The Verge', ARRAY['AAPL'], -0.15, 'neutral', NOW() - INTERVAL '1 day 4 hours');

-- ============================================
-- SOCIAL MENTIONS
-- ============================================

INSERT INTO social_mentions (platform, content, score, comments, symbols, sentiment_score, posted_at) VALUES
('reddit', 'NVDA is absolutely crushing it! The AI demand is insane. Been holding since $50 and not selling anytime soon. 🚀', 1250, 89, ARRAY['NVDA'], 0.9, NOW() - INTERVAL '1 hour'),
('reddit', 'Apple earnings beat was impressive but worried about China sales. Anyone else concerned about that market?', 420, 156, ARRAY['AAPL'], 0.1, NOW() - INTERVAL '2 hours'),
('reddit', 'Microsoft''s AI integration across products is underrated. GitHub Copilot alone is worth the investment.', 890, 72, ARRAY['MSFT'], 0.75, NOW() - INTERVAL '3 hours'),
('reddit', 'Tesla new gigafactory announcement is bullish but execution is everything. Let''s see if they can deliver.', 650, 210, ARRAY['TSLA'], 0.45, NOW() - INTERVAL '5 hours'),
('reddit', 'Google''s DeepMind just keeps delivering. The medical AI stuff is genuinely impressive and could be huge.', 780, 65, ARRAY['GOOGL'], 0.8, NOW() - INTERVAL '6 hours'),
('reddit', 'AWS cost tools are nice but Azure has been catching up fast. Competition is good for everyone.', 320, 48, ARRAY['AMZN', 'MSFT'], 0.3, NOW() - INTERVAL '8 hours'),
('stocktwits', '$NVDA to the moon! Every dip is a buying opportunity with this AI revolution.', 45, 12, ARRAY['NVDA'], 0.95, NOW() - INTERVAL '30 minutes'),
('stocktwits', '$AAPL holding strong above $190. Support level looking solid.', 28, 8, ARRAY['AAPL'], 0.6, NOW() - INTERVAL '1 hour'),
('stocktwits', '$TSLA volatility is crazy but the long term thesis is intact. EV adoption only going up.', 56, 23, ARRAY['TSLA'], 0.5, NOW() - INTERVAL '4 hours'),
('stocktwits', '$MSFT Azure growth is the real story here. Cloud is king.', 34, 11, ARRAY['MSFT'], 0.7, NOW() - INTERVAL '7 hours');

-- ============================================
-- TRADING DECISIONS
-- ============================================

-- Insert sample trading decisions for P&L visualization
INSERT INTO trading_decisions (symbol, action, quantity, confidence, reasoning, executed, outcome_pnl, outcome_pnl_percent, created_at) VALUES
('AAPL', 'buy', 20, 0.75, 'Strong earnings beat with positive guidance. Technical indicators showing bullish momentum.', true, 350.00, 4.5, NOW() - INTERVAL '25 days'),
('NVDA', 'buy', 15, 0.88, 'AI demand continues to exceed expectations. Major contract announcement provides strong catalyst.', true, 412.50, 7.8, NOW() - INTERVAL '22 days'),
('MSFT', 'hold', NULL, 0.65, 'Azure growth strong but stock appears fairly valued. Maintain existing position.', true, 0, 0, NOW() - INTERVAL '20 days'),
('TSLA', 'sell', 10, 0.55, 'Taking partial profits after recent run-up. Valuation stretched relative to peers.', true, -125.00, -2.1, NOW() - INTERVAL '18 days'),
('GOOGL', 'buy', 25, 0.72, 'DeepMind breakthrough and search AI improvements provide growth catalysts.', true, 287.50, 3.2, NOW() - INTERVAL '15 days'),
('AAPL', 'hold', NULL, 0.70, 'Vision Pro concerns offset by strong iPhone demand. Maintain position.', true, 0, 0, NOW() - INTERVAL '12 days'),
('NVDA', 'buy', 20, 0.82, 'Analyst upgrades and continued AI momentum. Adding to position on pullback.', true, 520.00, 9.2, NOW() - INTERVAL '10 days'),
('AMZN', 'buy', 15, 0.60, 'AWS cost tools launch and retail strength. Good entry point.', true, 180.00, 2.5, NOW() - INTERVAL '8 days'),
('MSFT', 'buy', 10, 0.78, 'Azure AI services gaining market share. Copilot monetization beginning.', true, 258.00, 6.1, NOW() - INTERVAL '5 days'),
('TSLA', 'buy', 15, 0.58, 'Gigafactory announcement and EV market recovery. Re-entering position.', true, 112.50, 1.8, NOW() - INTERVAL '3 days'),
('AAPL', 'hold', NULL, 0.68, 'Q4 results strong. Waiting for services revenue data before adjusting.', true, 0, 0, NOW() - INTERVAL '2 days'),
('NVDA', 'hold', NULL, 0.85, 'Position sized appropriately. AI thesis intact, no changes needed.', true, 0, 0, NOW() - INTERVAL '1 day'),
('GOOGL', 'buy', 15, 0.71, 'Search AI improvements driving engagement. Medical AI potential underappreciated.', true, 122.50, 2.1, NOW() - INTERVAL '12 hours');

-- ============================================
-- ORDERS
-- ============================================

INSERT INTO orders (symbol, action, quantity, order_type, status, filled_quantity, avg_fill_price, mode, created_at, filled_at) VALUES
('AAPL', 'buy', 20, 'market', 'filled', 20, 182.50, 'paper', NOW() - INTERVAL '25 days', NOW() - INTERVAL '25 days'),
('NVDA', 'buy', 15, 'market', 'filled', 15, 118.25, 'paper', NOW() - INTERVAL '22 days', NOW() - INTERVAL '22 days'),
('TSLA', 'sell', 10, 'market', 'filled', 10, 252.00, 'paper', NOW() - INTERVAL '18 days', NOW() - INTERVAL '18 days'),
('GOOGL', 'buy', 25, 'market', 'filled', 25, 168.50, 'paper', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days'),
('NVDA', 'buy', 20, 'market', 'filled', 20, 132.00, 'paper', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
('AMZN', 'buy', 15, 'limit', 'filled', 15, 178.00, 'paper', NOW() - INTERVAL '8 days', NOW() - INTERVAL '8 days'),
('MSFT', 'buy', 10, 'market', 'filled', 10, 412.00, 'paper', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days'),
('TSLA', 'buy', 15, 'market', 'filled', 15, 238.50, 'paper', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days'),
('GOOGL', 'buy', 15, 'limit', 'pending', 0, NULL, 'paper', NOW() - INTERVAL '12 hours', NULL);

-- ============================================
-- UPDATE ACCOUNT TOTALS
-- ============================================

-- Calculate total portfolio value
WITH portfolio_value AS (
    SELECT COALESCE(SUM(market_value), 0) as total
    FROM portfolio
    WHERE quantity > 0
)
UPDATE accounts
SET 
    total_value = cash + (SELECT total FROM portfolio_value),
    total_pnl = (SELECT COALESCE(SUM(unrealized_pnl), 0) FROM portfolio WHERE quantity > 0),
    updated_at = NOW()
WHERE name = 'default';

SELECT 
    'Seed data loaded successfully!' as status,
    (SELECT COUNT(*) FROM market_data) as market_data_rows,
    (SELECT COUNT(*) FROM news_articles) as news_rows,
    (SELECT COUNT(*) FROM social_mentions) as social_rows,
    (SELECT COUNT(*) FROM portfolio WHERE quantity > 0) as positions,
    (SELECT COUNT(*) FROM trading_decisions) as decisions,
    (SELECT COUNT(*) FROM orders) as orders;
