'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { useSystem } from '@/components/providers/SystemDataProvider';
import { useToast } from '@/components/providers/ToastProvider';
import {
  RULE_DEFS,
  formatCurrent,
  ruleKeys,
  ruleTitle,
  saveOrder,
  validateRule,
  type RuleDef
} from '@/components/rules/ruleDefs';
import {
  clearThreshold,
  loadThresholds,
  writeThreshold,
  type Threshold
} from '@/components/rules/thresholdApi';
import { PageBody } from '@/components/ui/PageBody';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils';

// Alert rules: alert timing (fire/resolve delays), then each rule's
// enter/clear thresholds, edited at runtime (applied on the next collection
// tick) or reset to the environment default.

type Draft = { enter: string; clear: string };

const FIRE_KEY = 'ALERT_FIRE_DELAY_SECONDS';
const RESOLVE_KEY = 'ALERT_RESOLVE_DELAY_SECONDS';
const FIRE_OPTIONS = [0, 15, 30, 60];
const RESOLVE_OPTIONS = [0, 30, 60, 120];

// Segmented options for a delay, keeping a configured value outside the presets selectable.
function delayOptions(presets: number[], current: number | undefined) {
  const values =
    current === undefined || presets.includes(current)
      ? presets
      : [...presets, current].sort((a, b) => a - b);
  return values.map(value => ({ value, label: value === 0 ? 'Off' : `${value}s` }));
}

const input =
  'w-[76px] rounded-md border border-white/10 bg-sidebar px-2 py-1.5 font-mono text-[12.5px] outline-none focus:border-accent';

export default function AlertRulesPage() {
  const { data } = useSystem();
  const flash = useToast();
  const [thresholds, setThresholds] = useState<Record<string, Threshold> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Replace the drafts of the given rules with the stored values.
  const apply = useCallback((list: Threshold[], rules: RuleDef[]) => {
    const byKey = Object.fromEntries(list.map(threshold => [threshold.key, threshold]));
    setThresholds(byKey);
    setDrafts(previous => {
      const next = { ...previous };
      for (const rule of rules) {
        next[rule.id] = {
          enter: String(byKey[rule.enterKey]?.value ?? ''),
          clear: String(byKey[rule.clearKey]?.value ?? '')
        };
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void loadThresholds().then(result => {
      if (result.ok) apply(result.thresholds, RULE_DEFS);
      else setErrors({ page: result.error });
    });
  }, [apply]);

  const save = async (rule: RuleDef) => {
    const draft = drafts[rule.id];
    const enter = thresholds?.[rule.enterKey];
    const clear = thresholds?.[rule.clearKey];
    if (!draft || !enter || !clear) return;
    const problem = validateRule(rule, draft.enter, draft.clear);
    setErrors(previous => ({ ...previous, [rule.id]: problem }));
    if (problem) return;

    setBusy(rule.id);
    const next = { enter: Number(draft.enter), clear: Number(draft.clear) };
    let latest: Threshold[] | null = null;
    for (const which of saveOrder(rule, enter.value, next.enter)) {
      const result = await writeThreshold(which === 'enter' ? enter : clear, next[which]);
      if (!result.ok) {
        setErrors(previous => ({ ...previous, [rule.id]: result.error }));
        break;
      }
      latest = result.thresholds;
    }
    setBusy(null);
    if (latest) {
      apply(latest, [rule]);
      flash(`${rule.label} thresholds saved`);
    }
  };

  const setDelay = async (threshold: Threshold | undefined, value: number, done: string) => {
    if (!threshold) return;
    setBusy(threshold.key);
    const result = await writeThreshold(threshold, value);
    setBusy(null);
    if (result.ok) {
      apply(result.thresholds, []);
      flash(done);
    } else {
      flash(result.error);
    }
  };

  const reset = async (rule: RuleDef) => {
    setBusy(rule.id);
    await clearThreshold(rule.enterKey);
    const result = await clearThreshold(rule.clearKey);
    setBusy(null);
    if (result.ok) {
      apply(result.thresholds, [rule]);
      setErrors(previous => ({ ...previous, [rule.id]: null }));
      flash(`${rule.label} reset to default`);
    } else {
      setErrors(previous => ({ ...previous, [rule.id]: result.error }));
    }
  };

  return (
    <PageBody className="max-w-[1100px]">
      <p className="max-w-[720px] text-[13px] leading-[1.55] text-pretty text-muted">
        Changes apply on the next collection tick, no restart needed. A value stays overridden until you reset
        it to the environment default. An alert fires above <span className="text-fg">Enter</span> and clears
        below <span className="text-fg">Clear</span> (reversed for low-is-bad rules).
      </p>
      {errors.page && <p className="text-xs text-crit-fg">Could not load thresholds: {errors.page}</p>}

      {thresholds && (
        <section id="timing" className="scroll-mt-20 rounded-[10px] border border-line bg-card">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-white/5 px-[18px] py-3.5">
            <h2 className="flex-1 text-[13.5px] font-medium">Alert timing</h2>
            <span className="text-xs text-dim">
              {data && data.alertTiming.suppressedSpikes > 0
                ? `${data.alertTiming.suppressedSpikes} short spike${data.alertTiming.suppressedSpikes === 1 ? '' : 's'} suppressed (24h)`
                : 'No spikes suppressed yet'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-12 gap-y-[18px] px-[18px] py-4">
            {[
              {
                key: FIRE_KEY,
                title: 'Fire after the condition holds for',
                hint: "Shorter spikes are logged as suppressed and don't send a notification.",
                presets: FIRE_OPTIONS,
                done: (value: number) => `Alerts fire after ${value ? `${value}s` : 'no delay'}`
              },
              {
                key: RESOLVE_KEY,
                title: 'Resolve after the value recovers for',
                hint: 'Stops an alert from flapping open and closed around the threshold.',
                presets: RESOLVE_OPTIONS,
                done: (value: number) =>
                  `Alerts resolve after ${value ? `${value}s` : 'no delay'} of recovery`
              }
            ].map(setting => {
              const threshold = thresholds[setting.key];
              return (
                <div key={setting.key} className="flex flex-[1_1_260px] flex-col gap-2">
                  <span className="text-[13px]">{setting.title}</span>
                  <div className="self-start">
                    <Segmented
                      options={delayOptions(setting.presets, threshold?.value)}
                      value={threshold?.value ?? 0}
                      onChange={value => void setDelay(threshold, value, setting.done(value))}
                      label={setting.title}
                    />
                  </div>
                  <span className="text-xs leading-normal text-pretty text-subtle">
                    {setting.hint} <span className="font-mono text-faint">{setting.key}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-[10px] border border-line bg-card">
        {thresholds === null
          ? !errors.page && <p className="px-[18px] py-4 text-[12.5px] text-subtle">Loading…</p>
          : RULE_DEFS.map(rule => {
              const enter = thresholds[rule.enterKey];
              const clear = thresholds[rule.clearKey];
              if (!enter || !clear) return null;
              const draft = drafts[rule.id] ?? { enter: '', clear: '' };
              const dirty = draft.enter !== String(enter.value) || draft.clear !== String(clear.value);
              const overridden = enter.override !== null || clear.override !== null;
              const firing = data?.activeAlerts.some(alert => alert.key === rule.alertKey) ?? false;
              const current = data ? rule.current(data) : null;
              const set = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => {
                const value = event.target.value;
                setDrafts(previous => ({
                  ...previous,
                  [rule.id]: { ...draft, ...previous[rule.id], [field]: value }
                }));
              };

              return (
                <div
                  key={rule.id}
                  className={cn(
                    'flex flex-col gap-2 border-t border-line-soft px-[18px] py-3.5 first:border-t-0',
                    firing && 'bg-crit/4'
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                    <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-medium">{ruleTitle(rule)}</span>
                        {overridden && (
                          <span className="rounded-[3px] bg-accent/14 px-1.5 py-px font-mono text-[10px] text-info-fg">
                            overridden
                          </span>
                        )}
                        {firing && (
                          <span className="rounded-[3px] bg-crit/14 px-1.5 py-px font-mono text-[10px] text-crit-fg">
                            firing
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-[11px] text-faint">
                        {ruleKeys(rule)} · default {enter.default} / {clear.default}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'flex-[0_0_110px] font-mono text-xs',
                        firing ? 'text-crit-fg' : current === null ? 'text-faint' : 'text-fg-3'
                      )}
                    >
                      {formatCurrent(rule, current)}
                    </span>
                    <label className="flex items-center gap-2 text-[11.5px] text-subtle">
                      {rule.direction === 'pair' ? 'RAM %' : 'Enter'}
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={draft.enter}
                        onChange={set('enter')}
                        className={input}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[11.5px] text-subtle">
                      {rule.direction === 'pair' ? 'Swap %' : 'Clear'}
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={draft.clear}
                        onChange={set('clear')}
                        className={input}
                      />
                    </label>
                    <div className="flex flex-[0_0_140px] justify-end gap-1.5">
                      <button
                        onClick={() => void save(rule)}
                        disabled={!dirty || busy === rule.id}
                        className={cn(
                          'rounded-md px-3 py-[5px] text-xs',
                          dirty ? 'bg-accent text-canvas' : 'bg-white/4 text-subtle'
                        )}
                      >
                        Save
                      </button>
                      {overridden && (
                        <button
                          onClick={() => void reset(rule)}
                          disabled={busy === rule.id}
                          className="rounded-md bg-white/6 px-3 py-[5px] text-xs text-fg-3 hover:bg-white/10"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {errors[rule.id] && <span className="text-xs text-crit-fg">{errors[rule.id]}</span>}
                </div>
              );
            })}
      </section>
    </PageBody>
  );
}
