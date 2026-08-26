const { useState, useEffect } = React;

// ── Initialize Supabase client ───
const supabase = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
);

function App() {
    // ── Login / session state ─────
    const [currentUser, setCurrentUser] = useState(() => {
        return localStorage.getItem('ourWork_currentUser') || null;
    });
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginError, setLoginError] = useState('');

    const handleLogin = (e) => {
        e.preventDefault();
        const uname = loginUsername.trim().toLowerCase();
        const users = window.APP_USERS || {};
        if (users[uname] && users[uname] === loginPassword) {
            const displayName = uname.charAt(0).toUpperCase() + uname.slice(1);
            localStorage.setItem('ourWork_currentUser', displayName);
            setCurrentUser(displayName);
            setLoginError('');
            setLoginPassword('');
        } else {
            setLoginError('Wrong username or password.');
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('ourWork_currentUser');
        setCurrentUser(null);
        setLoginUsername('');
        setLoginPassword('');
    };

    const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
    const [isHovered, setIsHovered] = useState(false);
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [members] = useState([
        { id: 'm1', name: 'Farjad' },
        { id: 'm4', name: 'Ahsan' }
    ]);
    const [activityLog, setActivityLog] = useState(() => {
        const saved = localStorage.getItem('ourWork_auditLog');
        return saved ? JSON.parse(saved) : [];
    });
    const [filterMember, setFilterMember] = useState('all');
    const [isAuditOpen, setIsAuditOpen] = useState(false);
    const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
    const [isTrashOpen, setIsTrashOpen] = useState(false);
    const [viewTask, setViewTask] = useState(null);
    const [deletedTasks, setDeletedTasks] = useState(() => {
        const saved = localStorage.getItem('ourWork_trash');
        return saved ? JSON.parse(saved) : [];
    });

    // New Task Form State
    const [newTaskTitle, setNewTaskTitle] = useState('');
    const [newTaskPriority, setNewTaskPriority] = useState('low');
    const [newTaskAssignee, setNewTaskAssignee] = useState('Farjad');
    const [newTaskDue, setNewTaskDue] = useState('');
    const [newTaskDescription, setNewTaskDescription] = useState('');
    const [createError, setCreateError] = useState('');

    // Comments State
    const [comments, setComments] = useState([]);
    const [newCommentText, setNewCommentText] = useState('');
    const [commentsLoading, setCommentsLoading] = useState(false);
    const [commentAuthor, setCommentAuthor] = useState('Farjad');

    // ── Custom cursor tracking ─────────
    useEffect(() => {
        const handleMouseMove = (e) => setCursorPos({ x: e.clientX, y: e.clientY });
        const handleMouseOver = (e) => {
            setIsHovered(!!e.target.closest('button, input, select, .interactive-card'));
        };
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseover', handleMouseOver);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseover', handleMouseOver);
        };
    }, []);

    // ── Stopwatch: tick ongoing tasks every second ──────────
    useEffect(() => {
        const interval = setInterval(() => {
            setTasks(prev => prev.map(t =>
                t.status === 'ongoing'
                    ? { ...t, time_spent_seconds: (t.time_spent_seconds || 0) + 1 }
                    : t
            ));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // ── Fetch tasks from Supabase on mount ─
    useEffect(() => {
        fetchTasks();

        const channel = supabase
            .channel('tasks-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_tasks' }, () => {
                fetchTasks();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, []);

    // ── Default form fields to whoever is logged in ─────────
    useEffect(() => {
        if (currentUser) {
            setNewTaskAssignee(currentUser);
            setCommentAuthor(currentUser);
        }
    }, [currentUser]);

    const fetchTasks = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('shared_tasks')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching tasks:', error.message);
        } else {
            console.log('📦 Raw status values from DB:', (data || []).map(t => t.status));
            const normalized = (data || []).map(t => ({
                ...t,
                status: t.status === 'done' ? 'completed'
                    : t.status === 'in_progress' ? 'ongoing'
                        : t.status === 'todo' ? 'pending'
                            : t.status
            }));
            setTasks(normalized);
        }
        setLoading(false);
    };

    // ── Activity log helper
    const logAction = (memberName, action) => {
        setActivityLog(prev => {
            const newLog = [{
                id: Date.now().toString(),
                member_name: memberName,
                action,
                timestamp: new Date().toLocaleTimeString()
            }, ...prev];
            // Persist the last 50 logs to local storage
            localStorage.setItem('ourWork_auditLog', JSON.stringify(newLog.slice(0, 50)));
            return newLog;
        });
    };

    // ── CREATE task ─────────
    const handleCreateTask = async (e) => {
        e.preventDefault();
        setCreateError('');
        if (!newTaskTitle.trim()) return;

        const payload = {
            title: newTaskTitle,
            description: newTaskDescription,
            status: 'pending',
            priority: newTaskPriority,
            assigned_to: newTaskAssignee,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from('shared_tasks').insert([payload]).select();
        if (error) {
            console.error('Error creating task:', error.message);
            setCreateError(`Supabase Error: ${error.message}`);
            return;
        }

        if (data && data.length > 0) {
            setTasks(prev => [data[0], ...prev]);
        } else {
            fetchTasks(); 
        }

        logAction(newTaskAssignee, `created task "${newTaskTitle}"`);
        setNewTaskTitle('');
        setNewTaskDescription('');
        setIsNewTaskOpen(false);
    };

    // ── VIEW TASK DETAILS (and fetch comments) ─────────────────
    const openTaskDetails = async (task) => {
        setViewTask(task);
        setCommentsLoading(true);
        setComments([]);
        const { data, error } = await supabase
            .from('task_comments')
            .select('*')
            .eq('task_id', task.id)
            .order('created_at', { ascending: true });

        if (!error && data) {
            setComments(data);
        } else if (error) {
            console.error('Error fetching comments:', error.message);
        }
        setCommentsLoading(false);
    };

    // ── POST COMMENT ──────────────────────────────────────────
    const handlePostComment = async (e) => {
        if (e) e.preventDefault();
        if (!newCommentText.trim() || !viewTask) return;

        const payload = {
            task_id: viewTask.id,
            author: commentAuthor,
            content: newCommentText,
            created_at: new Date().toISOString()
        };

        const { data, error } = await supabase.from('task_comments').insert([payload]).select();
        if (error) {
            console.error('Error posting comment:', error.message);
            alert(`Couldn't post comment: ${error.message}`);
            return;
        }

        if (data && data.length > 0) {
            setComments(prev => [...prev, data[0]]);
            setNewCommentText('');
        }
    };

    // ── UPDATE task status ─────────────────────────────────
    // Map app status → DB status before writing
    const toDbStatus = (appStatus) => {
        if (appStatus === 'completed') return 'done';
        return appStatus; // 'pending', 'ongoing', and 'deleted' stay as-is
    };

    const updateTaskStatus = async (id, newStatus, actor = 'System') => {
        // Only send status to DB — avoid failing if columns like completed_at don't exist
        const dbUpdate = { status: toDbStatus(newStatus) };

        const { error } = await supabase.from('shared_tasks').update(dbUpdate).eq('id', id);
        console.log('🔧 Updating task:', { id, dbUpdate, error });
        if (error) { console.error('Error updating task:', error.message); return; }

        setTasks(prev => prev.map(t => {
            if (t.id !== id) return t;
            // Use app-side newStatus for local state (not DB value)
            const updated = { ...t, status: newStatus };
            if (newStatus === 'completed') {
                confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
                logAction(actor, `completed task "${t.title}"`);
            } else if (newStatus === 'ongoing') {
                logAction(actor, `started task "${t.title}"`);
            } else {
                logAction(actor, `moved task "${t.title}" back to pending`);
            }
            return updated;
        }));
    };

    // ── DELETE task (Hard Delete from DB to Local Trash) ────
    const deleteTask = async (id, title) => {
        const taskToTrash = tasks.find(t => t.id === id);
        if (!taskToTrash) return;

        const { error } = await supabase.from('shared_tasks').delete().eq('id', id);
        if (error) {
            console.error('Error deleting task:', error.message);
            alert(`Delete failed: ${error.message}`);
            return;
        }

        setTasks(prev => prev.filter(t => t.id !== id));
        setDeletedTasks(prev => {
            const newTrash = [taskToTrash, ...prev].slice(0, 50); // Keep last 50
            localStorage.setItem('ourWork_trash', JSON.stringify(newTrash));
            return newTrash;
        });

        logAction('System', `deleted task "${title}"`);
    };

    // ── RESTORE task from Local Trash Archive ───────────────
    const restoreTask = async (id, title) => {
        const taskToRestore = deletedTasks.find(t => t.id === id);
        if (!taskToRestore) return;

        const { id: oldId, ...payload } = taskToRestore;
        payload.status = 'pending';

        const { data, error } = await supabase.from('shared_tasks').insert([payload]).select();
        if (error) { alert('Error restoring task: ' + error.message); return; }

        if (data && data.length > 0) {
            setTasks(prev => [data[0], ...prev]);
        } else {
            fetchTasks();
        }

        const newTrash = deletedTasks.filter(t => t.id !== id);
        setDeletedTasks(newTrash);
        localStorage.setItem('ourWork_trash', JSON.stringify(newTrash));

        logAction('System', `restored task "${title}" from trash`);
    };

    // ── PERMANENT DELETE (Clear from local archive) ─────────
    const permanentDeleteTask = async (id, title) => {
        const newTrash = deletedTasks.filter(t => t.id !== id);
        setDeletedTasks(newTrash);
        localStorage.setItem('ourWork_trash', JSON.stringify(newTrash));
        logAction('System', `cleared task "${title}" from local trash`);
    };

    // ── Helpers ─────────────────────────────────────────────
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
    };

    const completedCount = tasks.filter(t => t.status === 'completed').length;
    const completionPercentage = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
    const filteredTasks = tasks.filter(t => {
        if (filterMember === 'all') return true;
        const assigned = t.assigned_to || '';
        return assigned.toLowerCase().trim() === filterMember.toLowerCase().trim();
    });

    const getPriorityBadge = (priority) => {
        switch (priority) {
            case 'urgent': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-neonMagenta/20 text-neonMagenta border border-neonMagenta/40">Urgent</span>;
            case 'high': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-neonCoral/20 text-neonCoral border border-neonCoral/40">High</span>;
            case 'medium': return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-neonAmber/20 text-neonAmber border border-neonAmber/40">Medium</span>;
            default: return <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-neonMint/20 text-neonMint border border-neonMint/40">Low</span>;
        }
    };

    // ── Login gate ──────────────────────────────────────────
    if (!currentUser) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4">
                <div className="mesh-bg"></div>
                <form onSubmit={handleLogin} className="glass-card rounded-3xl p-8 border border-white/10 w-full max-w-sm relative z-10">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-pink-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                            <span className="font-extrabold text-white text-lg">N</span>
                        </div>
                        <div>
                            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-pink-200 bg-clip-text text-transparent">Our Work</h1>
                            <p className="text-xs text-slate-400">Sign in to continue</p>
                        </div>
                    </div>

                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Username</label>
                    <input
                        type="text"
                        value={loginUsername}
                        onChange={(e) => setLoginUsername(e.target.value)}
                        autoFocus
                        className="w-full bg-slate-900/80 border border-white/10 text-sm rounded-xl px-3 py-2.5 text-slate-200 mb-4 focus:outline-none focus:border-indigo-500"
                        placeholder="farjad or ahsan"
                    />

                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Password</label>
                    <input
                        type="password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full bg-slate-900/80 border border-white/10 text-sm rounded-xl px-3 py-2.5 text-slate-200 mb-4 focus:outline-none focus:border-indigo-500"
                        placeholder="••••••••"
                    />

                    {loginError && (
                        <p className="text-neonCoral text-xs font-semibold mb-4">{loginError}</p>
                    )}

                    <button type="submit"
                        className="btn-3d w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl">
                        Log In
                    </button>
                </form>
            </div>
        );
    }

    // ── Render ──────────────────────────────────────────────
    return (
        <div className="min-h-screen pb-16">
            {/* Floating custom cursor */}
            <div id="custom-cursor" style={{ left: `${cursorPos.x}px`, top: `${cursorPos.y}px` }} className={isHovered ? 'hovered' : ''}></div>

            {/* ── Header ── */}
            <header className="glass-card sticky top-0 z-40 border-b border-white/10 px-4 lg:px-8 py-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-pink-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                        <span className="font-extrabold text-white text-lg">N</span>
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-200 to-pink-200 bg-clip-text text-transparent">Our Work</h1>
                        <p className="text-xs text-slate-400">Real-Time Collaborative Workspace</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    {/* Progress Ring */}
                    <div className="hidden md:flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10">
                        <div className="relative w-10 h-10 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="20" cy="20" r="16" stroke="rgba(255,255,255,0.1)" strokeWidth="3" fill="none" />
                                <circle cx="20" cy="20" r="16" stroke="#10B981" strokeWidth="3" strokeDasharray="100.5"
                                    strokeDashoffset={100.5 - (100.5 * completionPercentage) / 100}
                                    strokeLinecap="round" fill="none" className="transition-all duration-500" />
                            </svg>
                            <span className="absolute text-xs font-bold text-white">{completionPercentage}%</span>
                        </div>
                        <div className="text-left">
                            <p className="text-xs text-slate-400">Progress</p>
                            <p className="text-sm font-bold">{completedCount} / {tasks.length} Done</p>
                        </div>
                    </div>

                    {/* Member Filter */}
                    <select value={filterMember} onChange={(e) => setFilterMember(e.target.value)}
                        className="bg-slate-900/80 border border-white/10 text-sm rounded-xl px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500">
                        <option value="all">All Members</option>
                        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                    </select>

                    <button onClick={() => setIsNewTaskOpen(true)}
                        className="btn-3d bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm px-4 py-2.5 rounded-xl">
                        + New Task
                    </button>

                    <button onClick={() => setIsTrashOpen(true)}
                        className="btn-3d bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm px-4 py-2.5 rounded-xl border border-white/10">
                        🗑 Trash ({deletedTasks.length})
                    </button>

                    <button onClick={() => setIsAuditOpen(true)}
                        className="btn-3d bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-sm px-4 py-2.5 rounded-xl border border-white/10">
                        Audit Log ({activityLog.length})
                    </button>

                    <div className="flex items-center gap-2 bg-white/5 px-3 py-2 rounded-xl border border-white/10">
                        <span className="text-sm text-slate-300">👋 {currentUser}</span>
                        <button onClick={handleLogout}
                            className="text-xs font-bold text-slate-400 hover:text-neonCoral">
                            Log Out
                        </button>
                    </div>
                </div>
            </header>

            {/* ── Kanban Board ── */}
            <main className="max-w-7xl mx-auto px-4 lg:px-8 mt-8">
                {loading ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-slate-400 text-sm animate-pulse">Loading tasks from database…</div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                        {/* Pending */}
                        <div className="glass-card rounded-3xl p-5 border border-white/10 flex flex-col gap-4">
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-neonAmber animate-pulse"></div>
                                    <h2 className="font-bold text-slate-200">Pending Tasks</h2>
                                </div>
                                <span className="bg-white/10 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                                    {filteredTasks.filter(t => t.status === 'pending').length}
                                </span>
                            </div>
                            <div className="flex flex-col gap-4">
                                {filteredTasks.filter(t => t.status === 'pending').map(task => (
                                    <div key={task.id} className="interactive-card glass-card rounded-2xl p-4 transition-transform hover:-translate-y-1">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-slate-100 cursor-pointer hover:text-indigo-400 flex items-center gap-2 group" onClick={() => openTaskDetails(task)}>
                                                {task.title} <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity">Details ⤤</span>
                                            </h3>
                                            {getPriorityBadge(task.priority)}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-400 mt-4 pt-3 border-t border-white/5">
                                            <span>👤 {task.assigned_to}</span>
                                            <button onClick={() => updateTaskStatus(task.id, 'ongoing', task.assigned_to)}
                                                className="btn-3d bg-indigo-600/80 hover:bg-indigo-600 text-white font-bold px-3 py-1.5 rounded-lg">
                                                ▶ Start Task
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {filteredTasks.filter(t => t.status === 'pending').length === 0 && (
                                    <div className="text-center py-10 text-slate-500 text-sm">No pending tasks</div>
                                )}
                            </div>
                        </div>

                        {/* Ongoing */}
                        <div className="glass-card rounded-3xl p-5 border border-white/10 flex flex-col gap-4">
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-indigo-500 animate-ping"></div>
                                    <h2 className="font-bold text-slate-200">Ongoing Tasks</h2>
                                </div>
                                <span className="bg-white/10 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                                    {filteredTasks.filter(t => t.status === 'ongoing').length}
                                </span>
                            </div>
                            <div className="flex flex-col gap-4">
                                {filteredTasks.filter(t => t.status === 'ongoing').map(task => (
                                    <div key={task.id} className="interactive-card glass-card rounded-2xl p-4 border-indigo-500/30 transition-transform hover:-translate-y-1">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-slate-100 cursor-pointer hover:text-indigo-400 flex items-center gap-2 group" onClick={() => openTaskDetails(task)}>
                                                {task.title} <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity">Details ⤤</span>
                                            </h3>
                                            {getPriorityBadge(task.priority)}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-400 mt-4 pt-3 border-t border-white/5">
                                            <button onClick={() => updateTaskStatus(task.id, 'pending', task.assigned_to)}
                                                className="text-slate-400 hover:text-white underline">↩ Undo</button>
                                            <button onClick={() => updateTaskStatus(task.id, 'completed', task.assigned_to)}
                                                className="btn-3d bg-neonMint hover:bg-emerald-600 text-slate-950 font-bold px-3 py-1.5 rounded-lg">
                                                ✓ Mark Done
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {filteredTasks.filter(t => t.status === 'ongoing').length === 0 && (
                                    <div className="text-center py-10 text-slate-500 text-sm">No ongoing tasks</div>
                                )}
                            </div>
                        </div>

                        {/* Completed */}
                        <div className="glass-card rounded-3xl p-5 border border-white/10 flex flex-col gap-4">
                            <div className="flex items-center justify-between border-b border-white/10 pb-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full bg-neonMint"></div>
                                    <h2 className="font-bold text-slate-200">Completed</h2>
                                </div>
                                <span className="bg-white/10 px-2.5 py-0.5 rounded-full text-xs font-semibold">
                                    {filteredTasks.filter(t => t.status === 'completed').length}
                                </span>
                            </div>
                            <div className="flex flex-col gap-4">
                                {filteredTasks.filter(t => t.status === 'completed').map(task => (
                                    <div key={task.id} className="interactive-card glass-card rounded-2xl p-4 border-emerald-500/20 opacity-80 transition-transform hover:opacity-100">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-semibold text-slate-300 line-through cursor-pointer hover:text-indigo-400 flex items-center gap-2 group" onClick={() => setViewTask(task)}>
                                                {task.title} <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full opacity-60 group-hover:opacity-100 transition-opacity no-underline">Details ⤤</span>
                                            </h3>
                                            {getPriorityBadge(task.priority)}
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-400 mt-4 pt-3 border-t border-white/5">
                                            <button onClick={() => deleteTask(task.id, task.title)} className="text-red-400 hover:text-red-300">
                                                🗑 Delete
                                            </button>
                                            <button onClick={() => updateTaskStatus(task.id, 'ongoing', task.assigned_to)}
                                                className="btn-3d bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-3 py-1.5 rounded-lg text-xs">
                                                ↺ Reopen
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {filteredTasks.filter(t => t.status === 'completed').length === 0 && (
                                    <div className="text-center py-10 text-slate-500 text-sm">No completed tasks yet</div>
                                )}
                            </div>
                        </div>

                    </div>
                )}
            </main>

            {/* ── New Task Modal ── */}
            {isNewTaskOpen && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-md rounded-3xl p-6 border border-white/10">
                        <h2 className="text-xl font-bold mb-4">Create New Shared Task</h2>
                        {createError && (
                            <div className="mb-4 bg-red-500/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl text-sm break-words">
                                {createError}
                            </div>
                        )}
                        <form onSubmit={handleCreateTask} className="flex flex-col gap-4">
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Task Title</label>
                                <input type="text" value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
                                    placeholder="e.g., Update Database Schema" required
                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Instructions / Reminders</label>
                                <textarea value={newTaskDescription} onChange={e => setNewTaskDescription(e.target.value)}
                                    placeholder="Add detailed instructions, reports, or reminders about this task..."
                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 min-h-[100px] resize-none" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Priority</label>
                                    <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value)}
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500">
                                        <option value="low">Low Priority</option>
                                        <option value="medium">Medium Priority</option>
                                        <option value="high">High Priority</option>
                                        <option value="urgent">Urgent Priority</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400 block mb-1">Assignee</label>
                                    <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
                                        className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500">
                                        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Date & Time</label>
                                <input type="datetime-local" value={newTaskDue} onChange={e => setNewTaskDue(e.target.value)}
                                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500" />
                            </div>
                            <div className="flex justify-end gap-3 mt-4">
                                <button type="button" onClick={() => setIsNewTaskOpen(false)}
                                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700">Cancel</button>
                                <button type="submit"
                                    className="btn-3d px-5 py-2 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-500 text-white">Create Task</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ── View Task Details Modal ── */}
            {viewTask && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4">
                    <div className="glass-card w-full max-w-lg rounded-3xl p-6 border border-white/10">
                        <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-4">
                            <div>
                                <h2 className="text-xl font-bold text-white max-w-sm truncate">{viewTask.title}</h2>
                                <p className="text-xs text-slate-400 mt-1">Assigned to: {viewTask.assigned_to}</p>
                            </div>
                            {getPriorityBadge(viewTask.priority)}
                        </div>
                        <div className="mb-2 min-h-[60px] max-h-[150px] overflow-y-auto">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Instructions / Report</h4>
                            <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed bg-slate-900/50 p-4 rounded-xl border border-white/5">
                                {viewTask.description || <span className="italic text-slate-500">No instructions or report provided for this task.</span>}
                            </div>
                        </div>

                        {/* Comments Section */}
                        <div className="mt-4 border-t border-white/10 pt-4 flex-1 flex flex-col min-h-0 bg-slate-900/30 rounded-xl relative">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-4 flex justify-between">
                                <span>💬 Discussion ({comments.length})</span>
                            </h4>

                            <div className="flex-1 overflow-y-auto px-4 max-h-[160px] flex flex-col gap-2 pb-2">
                                {commentsLoading ? (
                                    <div className="text-slate-500 text-xs text-center italic py-4">Loading comments...</div>
                                ) : comments.length === 0 ? (
                                    <div className="text-slate-500 text-xs text-center italic py-4">No comments yet. Start the conversation!</div>
                                ) : (
                                    comments.map(c => (
                                        <div key={c.id} className="bg-slate-800/80 rounded-lg p-3 border border-white/5 relative group transition-colors hover:border-indigo-500/30">
                                            <div className="flex justify-between items-baseline mb-1">
                                                <span className="font-bold text-indigo-300 text-xs">{c.author}</span>
                                                <span className="text-[9px] text-slate-500 font-mono">{new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            </div>
                                            <p className="text-slate-200 text-xs whitespace-pre-wrap">{c.content}</p>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="p-3 bg-slate-900 border-t border-white/5 rounded-b-xl flex gap-2 items-center">
                                <select value={commentAuthor} onChange={e => setCommentAuthor(e.target.value)}
                                    className="bg-slate-800 border border-white/10 text-xs rounded-lg px-2 py-2 text-slate-200 focus:outline-none h-[38px]">
                                    {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
                                </select>
                                <input type="text" value={newCommentText} onChange={e => setNewCommentText(e.target.value)}
                                    placeholder="Add a comment..."
                                    className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-3 py-2 text-white text-xs h-[38px] focus:outline-none focus:border-indigo-500"
                                    onKeyDown={e => { if (e.key === 'Enter') handlePostComment(e); }}
                                />
                                <button onClick={handlePostComment} disabled={!newCommentText.trim()}
                                    className="btn-3d bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-lg text-xs h-[38px] transition-all focus:outline-none">
                                    Send
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setViewTask(null)}
                                className="btn-3d px-5 py-2 rounded-xl text-sm font-bold bg-slate-800 hover:bg-slate-700 border border-white/10 text-white">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Audit Trail Drawer ── */}
            {isAuditOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end">
                    <div className="w-full max-w-md h-full bg-[#0D121D] border-l border-white/10 p-6 flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/10">
                            <h2 className="text-lg font-bold flex items-center gap-2"><span>📜</span> Audit History</h2>
                            <button onClick={() => setIsAuditOpen(false)} className="text-slate-400 hover:text-white p-2">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-3">
                            {activityLog.length === 0 && (
                                <div className="text-center py-10 text-slate-500 text-sm">No activity yet this session</div>
                            )}
                            {activityLog.map(log => (
                                <div key={log.id} className="glass-card rounded-2xl p-3.5 border border-white/5 flex flex-col gap-1">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-indigo-400">{log.member_name}</span>
                                        <span className="text-slate-500 font-mono">{log.timestamp}</span>
                                    </div>
                                    <p className="text-sm text-slate-300">{log.action}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Trash Drawer ── */}
            {isTrashOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-end">
                    <div className="w-full max-w-md h-full bg-[#0D121D] border-l border-white/10 p-6 flex flex-col shadow-2xl">
                        <div className="flex items-center justify-between pb-4 border-b border-white/10">
                            <h2 className="text-lg font-bold flex items-center gap-2 text-red-400"><span>🗑️</span> Deleted Tasks</h2>
                            <button onClick={() => setIsTrashOpen(false)} className="text-slate-400 hover:text-white p-2">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto py-4 flex flex-col gap-3">
                            {deletedTasks.length === 0 ? (
                                <div className="text-center py-10 text-slate-500 text-sm">Trash is currently empty</div>
                            ) : (
                                deletedTasks.map(t => (
                                    <div key={t.id} className="bg-slate-900 rounded-2xl p-4 border border-red-500/20">
                                        <div className="flex justify-between items-start mb-2">
                                            <h4 className="font-bold text-slate-300 line-through truncate">{t.title}</h4>
                                            {getPriorityBadge(t.priority)}
                                        </div>
                                        <p className="text-xs text-slate-500 mb-3 block">Task originally owned by: {t.assigned_to}</p>
                                        <div className="flex gap-2">
                                            <button onClick={() => restoreTask(t.id, t.title)} className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors w-full">
                                                Restore
                                            </button>
                                            <button onClick={() => permanentDeleteTask(t.id, t.title)} className="bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors w-full">
                                                Delete Permanently
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

ReactDOM.render(<App />, document.getElementById('root'));
