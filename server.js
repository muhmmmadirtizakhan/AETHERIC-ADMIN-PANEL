const express = require('express');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5501;

app.use(express.json());
app.use(express.static(__dirname));

// Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ==================== ADMIN LOGIN ====================
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const { data: admin, error } = await supabase
            .from('admin_users')
            .select('*')
            .eq('email', email)
            .single();
        
        if (error || !admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const validPassword = await bcrypt.compare(password, admin.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        res.json({
            success: true,
            admin: { id: admin.id, email: admin.email, role: admin.role }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== DASHBOARD STATS ====================
app.get('/api/admin/dashboard/stats', async (req, res) => {
    try {
        const { count: totalUsers } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });
        
        const { data: orders } = await supabase
            .from('orders')
            .select('total_amount, payment_status');
        
        const totalOrders = orders?.length || 0;
        const totalRevenue = orders?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;
        
        const pendingPayments = orders?.reduce((sum, order) => 
            order.payment_status === 'pending' ? sum + (order.total_amount || 0) : sum, 0) || 0;
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        const { data: userGrowth } = await supabase
            .from('users')
            .select('created_at')
            .gte('created_at', sevenDaysAgo.toISOString());
        
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const growthByDay = {};
        userGrowth?.forEach(user => {
            const dayName = dayNames[new Date(user.created_at).getDay()];
            growthByDay[dayName] = (growthByDay[dayName] || 0) + 1;
        });
        
        const growthData = dayNames.map(day => growthByDay[day] || 0);
        
        res.json({
            totalUsers: totalUsers || 0,
            totalOrders: totalOrders,
            totalRevenue: totalRevenue,
            pendingPayments: pendingPayments,
            userGrowth: growthData,
            totalNewUsers: userGrowth?.length || 0
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ==================== ORDERS ====================
app.get('/api/admin/orders', async (req, res) => {
    const { status } = req.query;
    
    try {
        let query = supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });
        
        if (status && status !== 'all') {
            query = query.eq('payment_status', status);
        }
        
        const { data: orders, error } = await query;
        
        if (error) throw error;
        
        if (!orders || orders.length === 0) {
            return res.json([]);
        }
        
        const ordersWithDetails = await Promise.all(
            orders.map(async (order) => {
                let customer_name = 'Unknown Customer';
                if (order.user_id) {
                    const { data: user } = await supabase
                        .from('users')
                        .select('full_name, email')
                        .eq('auth_id', order.user_id)
                        .single();
                    if (user) {
                        customer_name = user.full_name || user.email || 'Unknown';
                    }
                }
                
                const { data: items } = await supabase
                    .from('order_items')
                    .select('*')
                    .eq('order_id', order.id);
                
                return {
                    ...order,
                    order_items: items || [],
                    customer_name: customer_name
                };
            })
        );
        
        res.json(ordersWithDetails);
    } catch (error) {
        console.error('Fetch orders error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/orders/:orderId', async (req, res) => {
    const { orderId } = req.params;
    
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select('*')
            .eq('order_number', orderId)
            .single();
        
        if (error) throw error;
        
        let customer_name = 'Unknown Customer';
        if (order.user_id) {
            const { data: user } = await supabase
                .from('users')
                .select('full_name, email')
                .eq('auth_id', order.user_id)
                .single();
            if (user) {
                customer_name = user.full_name || user.email || 'Unknown';
            }
        }
        
        const { data: items } = await supabase
            .from('order_items')
            .select('*')
            .eq('order_id', order.id);
        
        res.json({
            ...order,
            order_items: items || [],
            customer_name: customer_name
        });
    } catch (error) {
        console.error('Fetch order error:', error);
        res.status(500).json({ error: 'Failed to fetch order' });
    }
});

// ==================== ANALYTICS ====================
app.get('/api/admin/analytics/sales-trend', async (req, res) => {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('total_amount, created_at')
            .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        if (!orders || orders.length === 0) {
            return res.json({ labels: [], data: [] });
        }
        
        const salesByDay = {};
        orders.forEach(order => {
            const date = new Date(order.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            salesByDay[date] = (salesByDay[date] || 0) + (order.total_amount || 0);
        });
        
        const labels = Object.keys(salesByDay);
        const data = Object.values(salesByDay);
        
        res.json({ labels, data });
    } catch (error) {
        console.error('Sales trend error:', error);
        res.status(500).json({ error: 'Failed to fetch sales trend' });
    }
});

app.get('/api/admin/analytics/category-revenue', async (req, res) => {
    try {
        const { data: items, error } = await supabase
            .from('order_items')
            .select('category, subtotal');
        
        if (error) throw error;
        
        if (!items || items.length === 0) {
            return res.json({ labels: ['No Data'], data: [1] });
        }
        
        const categoryMap = {};
        items.forEach(item => {
            const category = item.category || 'General';
            categoryMap[category] = (categoryMap[category] || 0) + (item.subtotal || 0);
        });
        
        res.json({
            labels: Object.keys(categoryMap),
            data: Object.values(categoryMap)
        });
    } catch (error) {
        console.error('Category revenue error:', error);
        res.status(500).json({ error: 'Failed to fetch category revenue' });
    }
});

app.get('/api/admin/analytics/top-products', async (req, res) => {
    try {
        const { data: items, error } = await supabase
            .from('order_items')
            .select('product_name, quantity');
        
        if (error) throw error;
        
        if (!items || items.length === 0) {
            return res.json({ labels: ['No Products'], data: [0] });
        }
        
        const productMap = {};
        items.forEach(item => {
            const name = item.product_name || 'Unknown';
            productMap[name] = (productMap[name] || 0) + (item.quantity || 0);
        });
        
        const sorted = Object.entries(productMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        res.json({
            labels: sorted.map(item => item[0]),
            data: sorted.map(item => item[1])
        });
    } catch (error) {
        console.error('Top products error:', error);
        res.status(500).json({ error: 'Failed to fetch top products' });
    }
});

app.get('/api/admin/analytics/peak-hours', async (req, res) => {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('created_at');
        
        if (error) throw error;
        
        const hourMap = {};
        orders?.forEach(order => {
            const hour = new Date(order.created_at).getHours();
            hourMap[hour] = (hourMap[hour] || 0) + 1;
        });
        
        const labels = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
        const data = labels.map((_, idx) => hourMap[10 + idx * 2] || 0);
        
        res.json({ labels, data });
    } catch (error) {
        console.error('Peak hours error:', error);
        res.status(500).json({ error: 'Failed to fetch peak hours' });
    }
});

// ==================== INITIALIZE ADMIN ====================
async function initializeAdmin() {
    try {
        const { data: existingAdmin } = await supabase
            .from('admin_users')
            .select('email')
            .eq('email', 'admin@aetheric.com')
            .single();
        
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash('Admin@123', 10);
            await supabase
                .from('admin_users')
                .insert([{
                    email: 'admin@aetheric.com',
                    password_hash: hashedPassword,
                    role: 'super_admin'
                }]);
            console.log('✅ Default admin created');
        } else {
            console.log('✅ Admin user already exists');
        }
    } catch (error) {
        console.log('⚠️ Admin table not ready yet');
    }
}

// ==================== SERVE FRONTEND ====================
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ==================== START SERVER ====================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🛡️ AETHERIC Admin Dashboard`);
        console.log(`📍 URL: http://localhost:${PORT}`);
        console.log(`🔐 Login: admin@aetheric.com / Admin@123\n`);
        initializeAdmin();
    });
}

// Vercel export
module.exports = app;
