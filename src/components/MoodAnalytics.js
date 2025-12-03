import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from 'firebase/firestore';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Dot, Line, LineChart } from 'recharts';

const MoodAnalytics = () => {
    const [moodData, setMoodData] = useState([]);
    const [wellnessTip, setWellnessTip] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedEntry, setSelectedEntry] = useState(null);
    const [timeFilter, setTimeFilter] = useState('7days'); // '7days' or '30days'

    // Mood label to numerical score mapping (Hugging Face michellejieli/emotion_text_classifier)
    // Model outputs: joy, sadness, anger, fear, surprise, disgust, neutral
    const moodScoreMap = {
        'joy': 5,           // Highest positive emotion
        'surprise': 4,      // Positive surprise
        'neutral': 3,       // Neutral baseline
        'disgust': 2,       // Negative but not extreme
        'sadness': 1,       // Negative emotion
        'fear': 1,         // Negative emotion (same as sadness)
        'anger': 0          // Lowest/most negative
    };

    // Wellness suggestions based on Hugging Face model labels
    const wellnessSuggestions = {
        'joy': {
            title: 'Maintain Your Joy! 🌟',
            tip: 'Keep doing what makes you happy! Consider journaling about what brought you joy today, and try to incorporate these activities into your daily routine. Share your positive energy with others and practice gratitude.',
            color: 'from-yellow-400 to-orange-400'
        },
        'surprise': {
            title: 'Embrace the Unexpected! ✨',
            tip: 'Life\'s surprises can be exciting! Take time to reflect on what surprised you and how it made you feel. Stay open to new experiences and consider how unexpected events can lead to growth.',
            color: 'from-purple-400 to-pink-400'
        },
        'neutral': {
            title: 'Find Your Balance 🧘',
            tip: 'A calm, neutral state is perfect for reflection. Try mindfulness meditation, deep breathing exercises, or a gentle walk in nature to maintain this peaceful state. Use this time for self-reflection.',
            color: 'from-blue-400 to-cyan-400'
        },
        'disgust': {
            title: 'Process Your Feelings 🌿',
            tip: 'Disgust is a natural protective emotion. Try to identify what specifically triggered this feeling. Consider journaling about it, talking to someone you trust, or engaging in activities that help you feel clean and refreshed.',
            color: 'from-green-500 to-emerald-500'
        },
        'sadness': {
            title: 'You\'re Not Alone 💙',
            tip: 'It\'s okay to feel sad. Try talking to a trusted friend, listening to calming music, or engaging in gentle activities like reading or taking a warm bath. Remember, this feeling will pass. Consider reaching out for support if sadness persists.',
            color: 'from-blue-500 to-indigo-500'
        },
        'fear': {
            title: 'Ground Yourself 🛡️',
            tip: 'Try a grounding exercise like 5-4-3-2-1: name 5 things you see, 4 you can touch, 3 you hear, 2 you smell, and 1 you taste. Practice deep breathing (4-7-8 technique) and break what\'s causing fear into smaller, manageable steps.',
            color: 'from-purple-400 to-pink-400'
        },
        'anger': {
            title: 'Channel Your Energy Positively 🔥',
            tip: 'Anger is a valid emotion. Try high-intensity exercise, punching a pillow, or writing down your feelings. Take deep breaths and count to 10 before responding. Consider what\'s really bothering you beneath the anger and address the root cause.',
            color: 'from-red-500 to-orange-500'
        }
    };

    useEffect(() => {
        const user = auth.currentUser;
        if (!user) {
            setLoading(false);
            return;
        }

        // Calculate date threshold based on time filter
        const now = new Date();
        const daysAgo = timeFilter === '7days' ? 7 : 30;
        const thresholdDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
        const thresholdTimestamp = Timestamp.fromDate(thresholdDate);

        // Fetch diary entries within the time range
        const q = query(
            collection(db, 'diary'),
            where('userId', '==', user.uid),
            where('createdAt', '>=', thresholdTimestamp),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const entries = snapshot.docs.map((doc) => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    date: data.createdAt ? data.createdAt.toDate() : (data.entryDate ? data.entryDate.toDate() : new Date())
                };
            });

            // Sort by date (oldest first for chart)
            entries.sort((a, b) => a.date.getTime() - b.date.getTime());

            // Transform entries to chart data
            const chartData = entries.map((entry) => {
                let moodScore = 3; // Default neutral
                let moodLabel = 'neutral';

                if (entry.moodAnalysis && entry.moodAnalysis.label) {
                    const label = entry.moodAnalysis.label.toLowerCase();
                    moodLabel = label;
                    moodScore = moodScoreMap[label] !== undefined ? moodScoreMap[label] : 3;
                } else if (entry.mood) {
                    // Fallback if mood is stored differently
                    const label = entry.mood.toLowerCase();
                    moodLabel = label;
                    moodScore = moodScoreMap[label] !== undefined ? moodScoreMap[label] : 3;
                }

                return {
                    date: entry.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                    fullDate: entry.date,
                    moodScore: moodScore,
                    moodLabel: moodLabel,
                    entry: entry
                };
            });

            setMoodData(chartData);

            // Get wellness tip from most recent entry
            if (chartData.length > 0) {
                const latestEntry = chartData[chartData.length - 1];
                const latestMood = latestEntry.moodLabel;
                const suggestion = wellnessSuggestions[latestMood] || wellnessSuggestions['neutral'];
                setWellnessTip({
                    ...suggestion,
                    mood: latestMood
                });
            }

            setLoading(false);
        }, (error) => {
            console.error('Error fetching mood data:', error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [timeFilter]);

    if (loading) {
        return (
            <div className="bg-white/60 backdrop-blur-xl rounded-3xl shadow-xl border border-gray-200/50 p-8">
                <div className="flex items-center justify-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-900"></div>
                </div>
            </div>
        );
    }

    if (moodData.length === 0) {
        return (
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 backdrop-blur-xl rounded-3xl shadow-xl border border-green-200/50 p-12">
                <div className="text-center py-12">
                    <div className="mb-6 flex justify-center">
                        <div className="w-24 h-24 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                        </div>
                    </div>
                    <h3 className="text-2xl font-bold text-gray-800 mb-3">Start Your Journey 📝</h3>
                    <p className="text-gray-600 mb-2 max-w-md mx-auto">
                        Your mood analytics will appear here once you start journaling.
                    </p>
                    <p className="text-sm text-gray-500 mb-6">
                        Write your first entry to begin tracking your emotional wellness!
                    </p>
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-900/10 rounded-full text-green-800 text-sm font-medium">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Switch to "Relax & Write" tab to get started
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Wellness Tip Card */}
            {wellnessTip && (
                <div className={`bg-gradient-to-br ${wellnessTip.color} rounded-3xl shadow-xl border border-white/20 p-6 backdrop-blur-sm`}>
                    <div className="bg-white/90 backdrop-blur-md rounded-2xl p-6">
                        <h3 className="text-2xl font-bold text-gray-800 mb-2">{wellnessTip.title}</h3>
                        <p className="text-gray-700 leading-relaxed">{wellnessTip.tip}</p>
                        <div className="mt-4 text-sm text-gray-600 italic">
                            Based on your recent mood: <span className="font-semibold capitalize">{wellnessTip.mood}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Time Filter */}
            <div className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200/50 p-4">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Time Range:</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setTimeFilter('7days')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                timeFilter === '7days'
                                    ? 'bg-green-900 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            Last 7 Days
                        </button>
                        <button
                            onClick={() => setTimeFilter('30days')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                timeFilter === '30days'
                                    ? 'bg-green-900 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                            Last 30 Days
                        </button>
                    </div>
                </div>
            </div>

            {/* Mood Trend Chart */}
            <div className="bg-white/60 backdrop-blur-xl rounded-3xl shadow-xl border border-gray-200/50 p-8">
                <div className="flex items-center justify-between mb-6">
                    <h3 className="text-2xl font-bold text-gray-800">Your Mood Trends</h3>
                    {selectedEntry && (
                        <button
                            onClick={() => setSelectedEntry(null)}
                            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Clear Selection
                        </button>
                    )}
                </div>
                
                <ResponsiveContainer width="100%" height={300}>
                    <AreaChart
                        data={moodData}
                        margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                    >
                        <defs>
                            <linearGradient id="colorMood" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.5} />
                        <XAxis 
                            dataKey="date" 
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                        />
                        <YAxis 
                            domain={[0, 5]}
                            stroke="#6b7280"
                            style={{ fontSize: '12px' }}
                            label={{ value: 'Mood Score', angle: -90, position: 'insideLeft', style: { fontSize: '12px' } }}
                        />
                        <Tooltip 
                            contentStyle={{
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '8px',
                                cursor: 'pointer'
                            }}
                            formatter={(value, name, props) => {
                                const dataPoint = props.payload;
                                return [
                                    `${value}/5 (${dataPoint.moodLabel || 'neutral'})`,
                                    'Mood Score'
                                ];
                            }}
                            labelFormatter={(label, payload) => {
                                if (payload && payload[0]) {
                                    return payload[0].payload.fullDate.toLocaleDateString('en-US', { 
                                        weekday: 'long', 
                                        month: 'long', 
                                        day: 'numeric' 
                                    });
                                }
                                return label;
                            }}
                        />
                        <Area 
                            type="monotone" 
                            dataKey="moodScore" 
                            stroke="#10b981" 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorMood)"
                        />
                        {/* Clickable line with dots for interaction */}
                        <Line
                            type="monotone"
                            dataKey="moodScore"
                            stroke="transparent"
                            strokeWidth={0}
                            dot={(props) => {
                                const isSelected = selectedEntry && selectedEntry.date === props.payload.date;
                                const handleClick = (e) => {
                                    e.stopPropagation();
                                    setSelectedEntry(props.payload);
                                };
                                return (
                                    <Dot
                                        {...props}
                                        r={isSelected ? 6 : 4}
                                        fill={isSelected ? "#059669" : "#10b981"}
                                        stroke={isSelected ? "#047857" : "#10b981"}
                                        strokeWidth={isSelected ? 2 : 1}
                                        style={{ cursor: 'pointer' }}
                                        onClick={handleClick}
                                    />
                                );
                            }}
                            activeDot={{ 
                                r: 6, 
                                fill: "#059669", 
                                stroke: "#047857", 
                                strokeWidth: 2, 
                                cursor: 'pointer',
                                onClick: (e, payload) => {
                                    setSelectedEntry(payload.payload);
                                }
                            }}
                        />
                    </AreaChart>
                </ResponsiveContainer>

                {/* Mood Score Legend */}
                <div className="mt-6 flex flex-wrap gap-4 justify-center text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
                        <span className="text-gray-600">Joy (5)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-purple-400"></div>
                        <span className="text-gray-600">Surprise (4)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-blue-400"></div>
                        <span className="text-gray-600">Neutral (3)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-green-500"></div>
                        <span className="text-gray-600">Disgust (2)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-blue-600"></div>
                        <span className="text-gray-600">Sadness/Fear (1)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full bg-red-500"></div>
                        <span className="text-gray-600">Anger (0)</span>
                    </div>
                </div>
            </div>

            {/* Selected Entry Display */}
            {selectedEntry && (
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl border border-gray-200/50 p-6 animate-in fade-in slide-in-from-bottom-4">
                    <div className="flex items-start justify-between mb-4">
                        <div>
                            <h4 className="text-lg font-bold text-gray-800 mb-1">
                                Journal Entry - {selectedEntry.fullDate.toLocaleDateString('en-US', { 
                                    weekday: 'long', 
                                    month: 'long', 
                                    day: 'numeric',
                                    year: 'numeric'
                                })}
                            </h4>
                            <div className="flex items-center gap-3">
                                <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
                                    selectedEntry.moodLabel === 'joy' ? 'bg-yellow-100 text-yellow-800' :
                                    selectedEntry.moodLabel === 'surprise' ? 'bg-purple-100 text-purple-800' :
                                    selectedEntry.moodLabel === 'neutral' ? 'bg-blue-100 text-blue-800' :
                                    selectedEntry.moodLabel === 'disgust' ? 'bg-green-100 text-green-800' :
                                    selectedEntry.moodLabel === 'sadness' || selectedEntry.moodLabel === 'fear' ? 'bg-blue-100 text-blue-800' :
                                    'bg-red-100 text-red-800'
                                }`}>
                                    {selectedEntry.moodLabel} ({selectedEntry.moodScore}/5)
                                </span>
                                {selectedEntry.entry.moodAnalysis && selectedEntry.entry.moodAnalysis.score && (
                                    <span className="text-xs text-gray-500">
                                        Confidence: {(selectedEntry.entry.moodAnalysis.score * 100).toFixed(0)}%
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => setSelectedEntry(null)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="bg-gray-50/80 rounded-xl p-4 border border-gray-200/50">
                        <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">
                            {selectedEntry.entry.content || 'No content available'}
                        </p>
                    </div>
                    <div className="mt-4 text-xs text-gray-500 italic">
                        💡 Click any point on the chart to view the journal entry from that day
                    </div>
                </div>
            )}

            {/* Summary Stats */}
            {moodData.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200/50 p-6">
                        <div className="text-sm text-gray-600 mb-1">Average Mood</div>
                        <div className="text-3xl font-bold text-gray-800">
                            {(moodData.reduce((sum, d) => sum + d.moodScore, 0) / moodData.length).toFixed(1)}/5
                        </div>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200/50 p-6">
                        <div className="text-sm text-gray-600 mb-1">Entries Analyzed</div>
                        <div className="text-3xl font-bold text-gray-800">{moodData.length}</div>
                    </div>
                    <div className="bg-white/60 backdrop-blur-xl rounded-2xl shadow-lg border border-gray-200/50 p-6">
                        <div className="text-sm text-gray-600 mb-1">Most Common Mood</div>
                        <div className="text-3xl font-bold text-gray-800 capitalize">
                            {(() => {
                                const moodCounts = {};
                                moodData.forEach(d => {
                                    moodCounts[d.moodLabel] = (moodCounts[d.moodLabel] || 0) + 1;
                                });
                                return Object.keys(moodCounts).reduce((a, b) => 
                                    moodCounts[a] > moodCounts[b] ? a : b, 'neutral'
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MoodAnalytics;

