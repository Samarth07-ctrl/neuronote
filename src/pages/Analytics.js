// src/pages/Analytics.js
import React, { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, orderBy, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import InteractiveBranch from "../components/InteractiveBranch";
import {
    BarChart, Bar, ComposedChart, Line,
    PieChart, Pie, Cell,
    RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import CalendarHeatmap from "react-calendar-heatmap";
import { format, subDays, startOfYear, eachDayOfInterval, isSameDay } from "date-fns";
import "react-calendar-heatmap/dist/styles.css";

// Mood label to numerical score mapping
const moodScoreMap = {
    'joy': 5,
    'surprise': 4,
    'neutral': 3,
    'disgust': 2,
    'sadness': 1,
    'fear': 1,
    'anger': 0
};

const COLORS = {
    joy: '#fbbf24',      // yellow-400
    surprise: '#a78bfa', // purple-400
    neutral: '#60a5fa',  // blue-400
    disgust: '#34d399',  // emerald-400
    sadness: '#3b82f6',  // blue-500
    fear: '#a78bfa',     // purple-400
    anger: '#ef4444'     // red-500
};

const StatCard = ({ title, value, subtext }) => (
    <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 flex flex-col items-center justify-center text-center shadow-lg transition-all hover:shadow-xl">
        <h3 className="text-sm font-medium text-gray-600 mb-1">{title}</h3>
        <p className="text-3xl font-bold text-green-900">{value}</p>
        {subtext && <p className="text-xs text-gray-500 mt-2">{subtext}</p>}
    </div>
);

export default function Analytics() {
    const [user, setUser] = useState(null);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        streak: 0,
        totalCheckIns: 0,
        averageMood: 0
    });

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        const q = query(
            collection(db, "diary"),
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc")
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedEntries = snapshot.docs.map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data.createdAt ? data.createdAt.toDate() : (data.entryDate ? data.entryDate.toDate() : new Date())
                };
            });

            setEntries(fetchedEntries);

            // Calculate stats
            const totalCheckIns = fetchedEntries.length;
            
            // Calculate streak
            let streak = 0;
            if (fetchedEntries.length > 0) {
                const sortedByDate = [...fetchedEntries].sort((a, b) => b.date.getTime() - a.date.getTime());
                let currentDate = new Date();
                currentDate.setHours(0, 0, 0, 0);
                
                for (let entry of sortedByDate) {
                    const entryDate = new Date(entry.date);
                    entryDate.setHours(0, 0, 0, 0);
                    const daysDiff = Math.floor((currentDate - entryDate) / (1000 * 60 * 60 * 24));
                    
                    if (daysDiff === streak) {
                        streak++;
                        currentDate = new Date(entryDate);
                    } else if (daysDiff > streak) {
                        break;
                    }
                }
            }

            // Calculate average mood
            let moodSum = 0;
            let moodCount = 0;
            fetchedEntries.forEach(entry => {
                if (entry.moodAnalysis && entry.moodAnalysis.label) {
                    const label = entry.moodAnalysis.label.toLowerCase();
                    const score = moodScoreMap[label] !== undefined ? moodScoreMap[label] : 3;
                    moodSum += score;
                    moodCount++;
                }
            });
            const averageMood = moodCount > 0 ? (moodSum / moodCount).toFixed(1) : 0;

            setStats({
                streak,
                totalCheckIns,
                averageMood
            });

            setLoading(false);
        }, (error) => {
            console.error("Error fetching entries:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    // Prepare data for charts
    const prepareMoodTrendData = () => {
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const date = subDays(new Date(), 29 - i);
            date.setHours(0, 0, 0, 0);
            return {
                date: format(date, 'MMM dd'),
                fullDate: date,
                mood: 0,
                count: 0
            };
        });

        entries.forEach(entry => {
            if (entry.moodAnalysis && entry.moodAnalysis.label) {
                const entryDate = new Date(entry.date);
                entryDate.setHours(0, 0, 0, 0);
                const dayData = last30Days.find(d => isSameDay(d.fullDate, entryDate));
                if (dayData) {
                    const label = entry.moodAnalysis.label.toLowerCase();
                    const score = moodScoreMap[label] !== undefined ? moodScoreMap[label] : 3;
                    dayData.mood = (dayData.mood * dayData.count + score) / (dayData.count + 1);
                    dayData.count++;
                }
            }
        });

        return last30Days.map(d => ({ ...d, mood: d.mood || null }));
    };

    const prepareMoodDistribution = () => {
        const distribution = {};
        entries.forEach(entry => {
            if (entry.moodAnalysis && entry.moodAnalysis.label) {
                const label = entry.moodAnalysis.label.toLowerCase();
                distribution[label] = (distribution[label] || 0) + 1;
            }
        });

        const total = Object.values(distribution).reduce((sum, val) => sum + val, 0);
        return Object.entries(distribution).map(([label, count]) => ({
            name: label.charAt(0).toUpperCase() + label.slice(1),
            value: total > 0 ? Math.round((count / total) * 100) : 0,
            count: count
        }));
    };

    const prepareLifeBalanceData = () => {
        const balanceAreas = ['Work', 'Social', 'Health', 'Hobbies', 'Growth'];
        const averages = {};
        
        balanceAreas.forEach(area => {
            let sum = 0;
            let count = 0;
            entries.forEach(entry => {
                if (entry.lifeBalance && entry.lifeBalance[area]) {
                    sum += entry.lifeBalance[area];
                    count++;
                }
            });
            averages[area] = count > 0 ? sum / count : 0;
        });

        return balanceAreas.map(area => ({
            area,
            value: averages[area],
            fullMark: 10
        }));
    };

    const prepareSleepMoodData = () => {
        const last14Days = Array.from({ length: 14 }, (_, i) => {
            const date = subDays(new Date(), 13 - i);
            date.setHours(0, 0, 0, 0);
            return {
                date: format(date, 'MMM dd'),
                fullDate: date,
                sleep: null,
                mood: null
            };
        });

        entries.forEach(entry => {
            const entryDate = new Date(entry.date);
            entryDate.setHours(0, 0, 0, 0);
            const dayData = last14Days.find(d => isSameDay(d.fullDate, entryDate));
            if (dayData) {
                if (entry.sleepHours !== undefined) {
                    dayData.sleep = entry.sleepHours;
                }
                if (entry.moodAnalysis && entry.moodAnalysis.label) {
                    const label = entry.moodAnalysis.label.toLowerCase();
                    dayData.mood = moodScoreMap[label] !== undefined ? moodScoreMap[label] : 3;
                }
            }
        });

        return last14Days;
    };

    const prepareTopEmotions = () => {
        const emotionCounts = {};
        entries.forEach(entry => {
            if (entry.moodAnalysis && entry.moodAnalysis.label) {
                const label = entry.moodAnalysis.label.toLowerCase();
                emotionCounts[label] = (emotionCounts[label] || 0) + 1;
            }
        });

        return Object.entries(emotionCounts)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 7)
            .map((emotion, index) => ({
                ...emotion,
                size: index === 0 ? 'text-4xl' : index < 3 ? 'text-3xl' : index < 5 ? 'text-2xl' : 'text-xl'
            }));
    };

    const prepareHeatmapData = () => {
        const startDate = startOfYear(new Date());
        const endDate = new Date();
        const allDays = eachDayOfInterval({ start: startDate, end: endDate });
        
        const entryDates = entries.map(e => {
            const d = new Date(e.date);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
        });

        return allDays.map(date => ({
            date: format(date, 'yyyy-MM-dd'),
            count: entryDates.filter(ts => {
                const d = new Date(ts);
                d.setHours(0, 0, 0, 0);
                return isSameDay(d, date);
            }).length
        }));
    };

    const getLastEntryContent = () => {
        if (entries.length === 0) return "Weekly AI Summary coming soon. Start journaling to see personalized insights!";
        const lastEntry = entries[0];
        return lastEntry.content || "Weekly AI Summary coming soon.";
    };

    const generateSuggestions = () => {
        const suggestions = [];
        
        // Calculate averages
        const avgMood = parseFloat(stats.averageMood);
        const recentEntries = entries.slice(0, 7);
        let avgSleep = 0;
        let sleepCount = 0;
        recentEntries.forEach(e => {
            if (e.sleepHours !== undefined) {
                avgSleep += e.sleepHours;
                sleepCount++;
            }
        });
        avgSleep = sleepCount > 0 ? avgSleep / sleepCount : 0;

        if (avgMood < 2.5) {
            suggestions.push({
                title: "Self-care Focus",
                desc: "Your mood has been lower recently. Consider practicing self-care activities like meditation or talking to a friend.",
                icon: "🧘"
            });
        }

        if (avgSleep < 6) {
            suggestions.push({
                title: "Sleep Hygiene",
                desc: "Your sleep hours are below recommended levels. Try establishing a consistent bedtime routine.",
                icon: "🌙"
            });
        }

        if (avgSleep >= 6 && avgSleep < 7) {
            suggestions.push({
                title: "Sleep Optimization",
                desc: "Consider aiming for 7-9 hours of sleep for optimal mental health and energy levels.",
                icon: "💤"
            });
        }

        if (suggestions.length === 0) {
            suggestions.push({
                title: "Maintain Your Routine",
                desc: "You're doing great! Keep up with your journaling and wellness practices.",
                icon: "✨"
            });
        }

        return suggestions.slice(0, 3);
    };

    if (loading) {
        return (
            <div className="relative min-h-[calc(100vh-80px)] overflow-hidden bg-gradient-to-b from-green-200 to-green-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-900"></div>
            </div>
        );
    }

    const moodTrendData = prepareMoodTrendData();
    const moodDistribution = prepareMoodDistribution();
    const lifeBalanceData = prepareLifeBalanceData();
    const sleepMoodData = prepareSleepMoodData();
    const topEmotions = prepareTopEmotions();
    const heatmapData = prepareHeatmapData();
    const suggestions = generateSuggestions();

    return (
        <div className="relative min-h-[calc(100vh-80px)] overflow-hidden bg-gradient-to-b from-green-200 to-green-50">
            {/* Interactive Branch Background */}
            <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
                <InteractiveBranch />
            </div>

            {/* Content */}
            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-24">
                <div className="mb-10">
                    <h1 className="text-4xl md:text-5xl font-light text-gray-900 mb-2">
                        Wellness <span className="font-semibold text-green-900">Analytics</span>
                    </h1>
                    <p className="text-gray-600">Insights into your mental health journey</p>
                </div>

                {/* AI Insights Panel */}
                <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg mb-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-lg">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-2xl font-semibold text-gray-800">Hi, {user?.displayName || 'User'}</h3>
                            <p className="text-xs text-gray-500">Based on your recent conversations</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Summary Section */}
                        <div className="lg:col-span-1 bg-white/60 rounded-xl p-5 border border-gray-200/50 shadow-sm">
                            <h4 className="text-sm font-semibold text-green-900 mb-3 flex items-center gap-2">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Conversation Summary
                            </h4>
                            <p className="text-sm text-gray-700 leading-relaxed">
                                {getLastEntryContent()}
                            </p>
                        </div>

                        {/* Suggestions Section */}
                        <div className="lg:col-span-2">
                            <h4 className="text-sm font-semibold text-green-900 mb-3">Top Suggestions for You</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {suggestions.map((s, i) => (
                                    <div key={i} className="bg-white/60 hover:bg-white/90 transition-colors rounded-xl p-4 border border-gray-200/50 flex flex-col gap-3 items-center text-center shadow-sm">
                                        <div className="text-3xl">{s.icon}</div>
                                        <div>
                                            <h5 className="font-medium text-gray-900 text-sm mb-1">{s.title}</h5>
                                            <p className="text-xs text-gray-600 leading-snug">{s.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Stats Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <StatCard title="Current Streak" value={`${stats.streak} Days`} subtext="Keep it up!" />
                    <StatCard title="Total Check-ins" value={stats.totalCheckIns} subtext="All time" />
                    <StatCard title="Average Mood" value={`${stats.averageMood}/5`} subtext={stats.averageMood >= 3.5 ? "Feeling good" : "Room for improvement"} />
                </div>

                {/* Mood Trends & Distribution */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div className="lg:col-span-2 bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Mood Trends (30 Days)</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={moodTrendData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                                <XAxis dataKey="date" stroke="#6b7280" style={{ fontSize: '12px' }} />
                                <YAxis domain={[0, 5]} stroke="#6b7280" style={{ fontSize: '12px' }} label={{ value: 'Mood Score', angle: -90, position: 'insideLeft', style: { fontSize: '12px' } }} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                                    formatter={(value) => value ? [`${value.toFixed(1)}/5`, 'Mood'] : ['No data', '']}
                                />
                                <Bar dataKey="mood" fill="#064e3b" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Mood Distribution</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={moodDistribution}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={100}
                                    paddingAngle={5}
                                    dataKey="value"
                                >
                                    {moodDistribution.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[entry.name.toLowerCase()] || '#6b7280'} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => `${value}%`} />
                                <Legend 
                                    verticalAlign="bottom" 
                                    height={36}
                                    formatter={(value, entry) => `${value} (${entry.payload.count})`}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Life Balance, Sleep vs Mood, Top Emotions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* Life Balance Radar Chart */}
                    <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Life Balance</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <RadarChart data={lifeBalanceData}>
                                <PolarGrid stroke="#e5e7eb" />
                                <PolarAngleAxis dataKey="area" stroke="#6b7280" style={{ fontSize: '12px' }} />
                                <PolarRadiusAxis angle={90} domain={[0, 10]} stroke="#6b7280" style={{ fontSize: '10px' }} />
                                <Radar name="Balance" dataKey="value" stroke="#064e3b" fill="#064e3b" fillOpacity={0.6} />
                                <Tooltip />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Sleep vs Mood */}
                    <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Sleep vs Mood (14 Days)</h3>
                        <ResponsiveContainer width="100%" height={300}>
                            <ComposedChart data={sleepMoodData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                                <XAxis dataKey="date" stroke="#6b7280" style={{ fontSize: '12px' }} />
                                <YAxis yAxisId="left" domain={[0, 12]} stroke="#3b82f6" style={{ fontSize: '12px' }} label={{ value: 'Sleep (h)', angle: -90, position: 'insideLeft' }} />
                                <YAxis yAxisId="right" orientation="right" domain={[0, 5]} stroke="#064e3b" style={{ fontSize: '12px' }} label={{ value: 'Mood', angle: 90, position: 'insideRight' }} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                                />
                                <Legend />
                                <Bar yAxisId="left" dataKey="sleep" fill="#93c5fd" name="Sleep Hours" />
                                <Line yAxisId="right" type="monotone" dataKey="mood" stroke="#064e3b" strokeWidth={2} dot={{ fill: '#064e3b', r: 4 }} name="Mood Score" />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Top Emotions */}
                    <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                        <h3 className="text-lg font-semibold text-gray-800 mb-4">Top Emotions</h3>
                        <div className="flex flex-wrap items-center justify-center gap-4 h-64 content-center">
                            {topEmotions.length > 0 ? (
                                topEmotions.map((e, i) => (
                                    <span
                                        key={i}
                                        className={`${e.size} font-medium text-green-900/80 hover:text-green-900 hover:scale-110 transition-all cursor-default`}
                                        style={{ opacity: 0.6 + (e.count / Math.max(...topEmotions.map(em => em.count))) * 0.4 }}
                                    >
                                        {e.name}
                                    </span>
                                ))
                            ) : (
                                <p className="text-gray-500 text-sm">No emotion data yet</p>
                            )}
                        </div>
                    </div>
                </div>

                {/* Yearly Activity Heatmap */}
                <div className="bg-white/60 backdrop-blur-xl border border-gray-200/50 rounded-2xl p-6 shadow-lg">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Yearly Activity</h3>
                    <CalendarHeatmap
                        startDate={startOfYear(new Date())}
                        endDate={new Date()}
                        values={heatmapData}
                        classForValue={(value) => {
                            if (!value || value.count === 0) return 'color-empty';
                            if (value.count === 1) return 'color-scale-1';
                            if (value.count === 2) return 'color-scale-2';
                            if (value.count === 3) return 'color-scale-3';
                            return 'color-scale-4';
                        }}
                        tooltipDataAttrs={(value) => ({
                            'data-tip': value.date ? `${value.date}: ${value.count} ${value.count === 1 ? 'entry' : 'entries'}` : ''
                        })}
                    />
                    <div className="flex items-center justify-end gap-2 mt-4 text-xs text-gray-500">
                        <span>Less</span>
                        <div className="flex gap-1">
                            <div className="w-3 h-3 rounded-sm color-empty" />
                            <div className="w-3 h-3 rounded-sm color-scale-1" />
                            <div className="w-3 h-3 rounded-sm color-scale-2" />
                            <div className="w-3 h-3 rounded-sm color-scale-3" />
                            <div className="w-3 h-3 rounded-sm color-scale-4" />
                        </div>
                        <span>More</span>
                    </div>
                </div>
            </div>

            {/* Add CSS for heatmap colors */}
            <style>{`
                .color-empty { fill: #e5e7eb; }
                .color-scale-1 { fill: #86efac; }
                .color-scale-2 { fill: #4ade80; }
                .color-scale-3 { fill: #22c55e; }
                .color-scale-4 { fill: #16a34a; }
            `}</style>
        </div>
    );
}
