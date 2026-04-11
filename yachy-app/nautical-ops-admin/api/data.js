const { createClient } = require('@supabase/supabase-js');

const PLAN_MONTHLY = {
  '1_5': 79.99,
  '6_10': 89.99,
  '11_15': 119.99,
  '16_25': 149.99,
  '26_40': 199.99,
  '40_plus': 249.99,
};

const BILLING_MONTHS = {
  monthly: 1,
  '3_months': 3,
  '6_months': 6,
  '12_months': 12,
};

const BILLING_DISCOUNTS = {
  monthly: 0,
  '3_months': 0.05,
  '6_months': 0.08,
  '12_months': 0.1,
};

function calcMRR(sub) {
  const monthly = PLAN_MONTHLY[sub.plan_tier] ?? 0;
  const discount = BILLING_DISCOUNTS[sub.billing_period] ?? 0;
  return monthly * (1 - discount);
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'x-admin-password');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Password check
  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [
      usersRes,
      vesselsRes,
      subsRes,
      newUsersRes,
      newVesselsRes,
      tripsRes,
      maintenanceRes,
      tasksRes,
    ] = await Promise.all([
      supabase.from('users').select('id, name, email, role, vessel_id, created_at'),
      supabase.from('vessels').select('id, name, created_at'),
      supabase.from('vessel_subscriptions').select('*'),
      supabase.from('users').select('id, created_at').gte('created_at', sevenDaysAgo),
      supabase.from('vessels').select('id, created_at').gte('created_at', sevenDaysAgo),
      supabase.from('trips').select('id', { count: 'exact', head: true }),
      supabase.from('maintenance_logs').select('id', { count: 'exact', head: true }),
      supabase.from('vessel_tasks').select('id', { count: 'exact', head: true }),
    ]);

    const users = usersRes.data ?? [];
    const vessels = vesselsRes.data ?? [];
    const subs = subsRes.data ?? [];

    const captains = users.filter((u) => u.role === 'HOD');
    const crew = users.filter((u) => u.role === 'CREW');
    const activeSubs = subs.filter(
      (s) => s.status === 'active' && new Date(s.current_period_end) > now
    );
    const trialSubs = subs.filter(
      (s) => s.status === 'trialing' && new Date(s.current_period_end) > now
    );
    const mrr = activeSubs.reduce((sum, s) => sum + calcMRR(s), 0);
    const trialMrr = trialSubs.reduce((sum, s) => sum + calcMRR(s), 0);

    // Build vessels with crew counts and subscription info
    const vesselDetails = vessels.map((v) => {
      const crewCount = users.filter((u) => u.vessel_id === v.id).length;
      const captain = captains.find((c) => c.vessel_id === v.id);
      const sub = subs.find(
        (s) => s.vessel_id === v.id && ['active', 'trialing'].includes(s.status)
      );
      return {
        id: v.id,
        name: v.name,
        captain: captain?.name ?? '—',
        captainEmail: captain?.email ?? '—',
        crewCount,
        plan: sub?.plan_tier ?? '—',
        billingPeriod: sub?.billing_period ?? '—',
        status: sub?.status ?? 'no subscription',
        renewalDate: sub?.current_period_end ?? null,
        createdAt: v.created_at,
      };
    });

    // Daily signups for last 14 days
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    const dailySignups = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      dailySignups[key] = 0;
    }
    users.forEach((u) => {
      const d = new Date(u.created_at);
      if (d >= fourteenDaysAgo) {
        const key = d.toISOString().split('T')[0];
        if (key in dailySignups) dailySignups[key]++;
      }
    });

    return res.status(200).json({
      overview: {
        totalCaptains: captains.length,
        totalCrew: crew.length,
        totalUsers: users.length,
        totalVessels: vessels.length,
        activeSubscriptions: activeSubs.length,
        trialSubscriptions: trialSubs.length,
        mrr: Math.round(mrr * 100) / 100,
        trialMrr: Math.round(trialMrr * 100) / 100,
        newUsersLast7Days: newUsersRes.data?.length ?? 0,
        newVesselsLast7Days: newVesselsRes.data?.length ?? 0,
        totalTrips: tripsRes.count ?? 0,
        totalMaintenance: maintenanceRes.count ?? 0,
        totalTasks: tasksRes.count ?? 0,
      },
      vessels: vesselDetails,
      subscriptions: subs.map((s) => ({
        ...s,
        mrr: calcMRR(s),
      })),
      dailySignups,
    });
  } catch (err) {
    console.error('Dashboard data error:', err);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
};
