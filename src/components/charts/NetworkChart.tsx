import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import { formatNumber } from '@/utils/numberFormat';
import { NetworkHistoryEntry } from '@/types/system';

interface NetworkChartProps {
    data: NetworkHistoryEntry[];
    minimal?: boolean;
}

export const NetworkChart: React.FC<NetworkChartProps> = ({ data, minimal }) => {
    if (!data || data.length === 0) {
        return (
            <div className={`bg-gray-800 rounded-lg p-3 border border-gray-700${minimal ? ' h-40' : ''}`}>
                {!minimal && <div className="text-xs text-gray-300 mb-2">NETWORK ACTIVITY</div>}
                <div className={minimal ? 'h-36' : 'h-48 flex items-center justify-center'}>
                    <span className="text-gray-500 text-sm">No network data available</span>
                </div>
            </div>
        );
    }

    // 데이터 포인트 수에 따라 X축 레이블 생성
    const getXAxisLabel = (index: number) => {
        const totalPoints = data.length;
        const position = totalPoints - index - 1;
        
        if (position === 0) return 'now';
        if (position <= 3) return `${position}s`;
        return '';
    };

    // 데이터 포인트 수에 따라 표시할 레이블 수 조정
    const xAxisTicks = data.map((_, index) => index).filter(index => {
        const label = getXAxisLabel(index);
        return label !== '';
    });

    return (
        <div className={`bg-gray-800 rounded-lg p-3 border border-gray-700${minimal ? ' h-40' : ''}`}>
            {!minimal && <div className="text-xs text-gray-300 mb-2">NETWORK ACTIVITY</div>}
            <div className={minimal ? 'h-36' : 'h-48'}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <XAxis 
                            dataKey="time" 
                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                            tickFormatter={(_, index) => minimal ? '' : getXAxisLabel(index)}
                            ticks={minimal ? [] : xAxisTicks}
                        />
                        <YAxis 
                            tick={{ fontSize: 10, fill: '#9ca3af' }}
                            tickFormatter={(value) => `${formatNumber(value)} MB/s`}
                            hide={false}
                        />
                        <Tooltip 
                            formatter={(value) => [`${formatNumber(Number(value))} MB/s`, '']}
                            labelFormatter={(label) => `Time: ${label}`}
                            contentStyle={{ 
                                backgroundColor: '#1f2937',
                                border: '1px solid #374151',
                                borderRadius: '0.375rem',
                                color: '#e5e7eb'
                            }}
                        />
                        {!minimal && <Legend 
                            verticalAlign="top" 
                            height={36}
                            formatter={(value) => (
                                <span className="text-xs text-gray-400">{value}</span>
                            )}
                        />}
                        <Area
                            type="monotone"
                            dataKey="download"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            fill="url(#downloadGradient)"
                            name="Download"
                        />
                        <Area
                            type="monotone"
                            dataKey="upload"
                            stroke="#10b981"
                            strokeWidth={2}
                            fill="url(#uploadGradient)"
                            name="Upload"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}; 