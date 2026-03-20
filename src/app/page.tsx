"use client";

import React, { useState, useEffect } from 'react';

import { Header } from '@/components/common/Header';
import { SystemStats } from '@/components/stats/SystemStats';
import { ResourceUsage } from '@/components/stats/ResourceUsage';
import { ProcessList } from '@/components/stats/ProcessList';
import { fetchSystemData } from '@/services/systemService';
import { ServerData, NetworkHistoryEntry } from '@/types/system';

export default function DisplayPage() {
  const [systemData, setSystemData] = useState<ServerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkHistory, setNetworkHistory] = useState<NetworkHistoryEntry[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/system');
        if (!response.ok) {
          throw new Error('Failed to fetch system data');
        }
        const data = await response.json();
        
        // 데이터 유효성 검사
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid data format received');
        }

        // 필수 필드 확인
        const requiredFields = ['cpu', 'memory', 'disk', 'network', 'uptime', 'temperature', 'fan', 'processes'];
        const missingFields = requiredFields.filter(field => !data[field]);
        
        if (missingFields.length > 0) {
          throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
        }

        setSystemData(data);
        setError(null);

        // 네트워크 히스토리 업데이트
        const now = new Date();
        const time = now.toLocaleTimeString('ko-KR', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: false 
        });
        
        setNetworkHistory(prev => {
          const newHistory = [
            ...prev,
            {
              time,
              download: data.network.download,
              upload: data.network.upload
            }
          ];
          // 최대 60개의 데이터 포인트만 유지
          return newHistory.slice(-60);
        });
      } catch (err) {
        console.error('Error fetching system data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
        setSystemData(null);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 화면 잠김 방지
    const wakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.log('Wake lock failed:', err);
      }
    };
    wakeLock();
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Header error={error} />
        <div className="p-4">
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!systemData) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100">
        <Header error={null} />
        <div className="p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-800 rounded w-1/4"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-32 bg-gray-800 rounded"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <Header error={error} />
      <div className="p-2 sm:p-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 sm:gap-4">
          <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
            <SystemStats serverData={systemData} />
            <ResourceUsage serverData={systemData} networkHistory={networkHistory} />
          </div>
          <div className="h-[300px] sm:h-[calc(100vh-7rem)]">
            <ProcessList processes={systemData.processes} />
          </div>
        </div>
      </div>
    </div>
  );
}