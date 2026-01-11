-- Migration: Seed workflow definitions
-- This adds the predefined workflow definitions so they appear in the UI

-- Get agent IDs for reference
DO $$
DECLARE
    orchestrator_id UUID;
BEGIN
    -- Get the orchestrator agent ID
    SELECT id INTO orchestrator_id FROM agents WHERE type = 'orchestrator' LIMIT 1;

    -- Insert workflow definitions if they don't exist
    INSERT INTO workflows (name, description, trigger_type, entry_agent_id, graph_definition, enabled)
    VALUES 
    (
        'Trading Workflow',
        'Full trading pipeline: Research -> Analysis -> Decision. The orchestrator routes between teams based on what data is needed.',
        'api',
        orchestrator_id,
        '{
            "nodes": ["orchestrator", "research_team", "analysis_team", "decision_team"],
            "edges": [
                {"from": "research_team", "to": "orchestrator"},
                {"from": "analysis_team", "to": "orchestrator"},
                {"from": "decision_team", "to": "orchestrator"}
            ],
            "entryPoint": "orchestrator",
            "description": "Orchestrator routes to teams based on state, teams return results to orchestrator"
        }'::jsonb,
        true
    ),
    (
        'Research Workflow',
        'Data collection only: Fetches market data, news, and social sentiment for specified symbols.',
        'api',
        NULL,
        '{
            "nodes": ["research"],
            "edges": [{"from": "research", "to": "__end__"}],
            "entryPoint": "research",
            "description": "Single-step workflow that runs all research agents in parallel"
        }'::jsonb,
        true
    ),
    (
        'Analysis Workflow',
        'Research + Analysis: Fetches data then runs technical, fundamental, and sentiment analysis.',
        'api',
        NULL,
        '{
            "nodes": ["research", "analysis"],
            "edges": [
                {"from": "research", "to": "analysis"},
                {"from": "analysis", "to": "__end__"}
            ],
            "entryPoint": "research",
            "description": "Two-step workflow: research then analysis"
        }'::jsonb,
        true
    ),
    (
        'Decision Workflow',
        'Complete pipeline: Research -> Analysis -> Decision (Portfolio Manager + Risk Manager). Produces trading signals.',
        'api',
        NULL,
        '{
            "nodes": ["research", "analysis", "decision"],
            "edges": [
                {"from": "research", "to": "analysis"},
                {"from": "analysis", "to": "decision"},
                {"from": "decision", "to": "__end__"}
            ],
            "entryPoint": "research",
            "description": "Full pipeline ending with trading decisions"
        }'::jsonb,
        true
    ),
    (
        'Debate Workflow',
        'Bull vs Bear analysis: Research -> Bull Case -> Bear Case -> Synthesis. Produces balanced investment recommendations through adversarial debate.',
        'api',
        NULL,
        '{
            "nodes": ["research", "bull_researcher", "bear_researcher", "debate_synthesizer"],
            "edges": [
                {"from": "research", "to": "bull_researcher"},
                {"from": "research", "to": "bear_researcher"},
                {"from": "bull_researcher", "to": "debate_synthesizer"},
                {"from": "bear_researcher", "to": "debate_synthesizer"},
                {"from": "debate_synthesizer", "to": "__end__"}
            ],
            "entryPoint": "research",
            "description": "Adversarial debate workflow with bull and bear researchers providing opposing perspectives"
        }'::jsonb,
        true
    )
    ON CONFLICT DO NOTHING;
END $$;
