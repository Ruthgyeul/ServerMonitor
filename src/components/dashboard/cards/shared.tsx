import React from 'react';
import { LucideIcon } from 'lucide-react';

// Cross-cutting primitives every card file needs: the card frame itself and
// the "nothing to show" placeholder.

interface CardProps {
  icon: LucideIcon;
  color: string;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ icon: Icon, color, title, right, children }) => (
  <section className="dash-card rounded-lg border border-gray-700 bg-gray-800">
    <div className="dash-card-head flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon className="dash-icon shrink-0" color={color} strokeWidth={2} />
        <h2 className="t-label truncate uppercase tracking-[0.08em] text-gray-300">{title}</h2>
      </div>
      {right}
    </div>
    {children}
  </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="t-body text-gray-500">{children}</p>
);
