
import express from 'express';
import { supabase } from '../services/supabaseService.js';

const router = express.Router();

// Middleware to check if Supabase is connected
const requireSupabase = (req, res, next) => {
    if (!supabase) {
        return res.status(503).json({ error: 'Supabase not connected' });
    }
    next();
};

// 1. GLOBAL PERFORMANCE
router.get('/global', requireSupabase, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('view_global_performance')
            .select('*')
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching global stats:', err);
        res.status(500).json({ error: err.message });
    }
});

// 2. CATEGORY PERFORMANCE
router.get('/category', requireSupabase, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('view_category_performance')
            .select('*')
            .order('total_pnl', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching category stats:', err);
        res.status(500).json({ error: err.message });
    }
});

// 3. STRATEGY PERFORMANCE
router.get('/strategy', requireSupabase, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('view_strategy_performance')
            .select('*')
            .order('total_pnl', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching strategy stats:', err);
        res.status(500).json({ error: err.message });
    }
});

// 4. MONTHLY PNL
router.get('/monthly', requireSupabase, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('view_monthly_pnl')
            .select('*')
            .order('month', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('Error fetching monthly stats:', err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
