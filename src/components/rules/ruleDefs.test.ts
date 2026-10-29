import { describe, expect, it } from 'vitest';

import {
  RULE_DEFS,
  formatCurrent,
  ruleKeys,
  ruleTitle,
  saveOrder,
  validateRule
} from '@/components/rules/ruleDefs';
import { CONFIGURABLE_THRESHOLDS } from '@/utils/collectors/alertOverrides';

const rule = (id: string) => RULE_DEFS.find(candidate => candidate.id === id)!;

describe('RULE_DEFS', () => {
  it('only references keys the server lets the UI configure', () => {
    const configurable = new Set(CONFIGURABLE_THRESHOLDS.map(threshold => threshold.key));
    for (const def of RULE_DEFS) {
      expect(configurable.has(def.enterKey)).toBe(true);
      expect(configurable.has(def.clearKey)).toBe(true);
    }
  });

  it('labels rows with their unit and env keys', () => {
    expect(ruleTitle(rule('cpu'))).toBe('CPU usage (%)');
    expect(ruleTitle(rule('diskFill'))).toBe('Disk fill forecast (hours)');
    expect(ruleTitle(rule('memPressure'))).toBe('Memory pressure');
    expect(ruleKeys(rule('cpu'))).toBe('ALERT_CPU_ENTER / _CLEAR');
    expect(ruleKeys(rule('diskFill'))).toBe('ALERT_DISKFILL_ENTER_HOURS / CLEAR_HOURS');
    expect(ruleKeys(rule('memPressure'))).toBe('ALERT_MEMPRESSURE_MEM / _SWAP');
  });

  it('formats the live value', () => {
    expect(formatCurrent(rule('cpu'), 23.44)).toBe('now 23.4%');
    expect(formatCurrent(rule('load'), 0.5)).toBe('now 0.50');
    expect(formatCurrent(rule('temp'), null)).toBe('now no sensor');
    expect(formatCurrent(rule('diskFill'), null)).toBe('now not filling');
    expect(formatCurrent(rule('swap'), null)).toBe('now off');
  });
});

describe('validateRule', () => {
  it('requires non-negative numbers', () => {
    expect(validateRule(rule('cpu'), '', '80')).toBe('Values must be numbers.');
    expect(validateRule(rule('cpu'), 'x', '80')).toBe('Values must be numbers.');
    expect(validateRule(rule('cpu'), '-1', '80')).toBe('Values must be non-negative numbers.');
  });

  it('keeps the hysteresis band the right way round', () => {
    expect(validateRule(rule('cpu'), '90', '80')).toBeNull();
    expect(validateRule(rule('cpu'), '80', '80')).toMatch(/greater than Clear/);
    expect(validateRule(rule('battery'), '15', '25')).toBeNull();
    expect(validateRule(rule('battery'), '30', '25')).toMatch(/lower than Clear/);
    expect(validateRule(rule('memPressure'), '70', '90')).toBeNull();
  });
});

describe('saveOrder', () => {
  it('writes the value that widens the band first', () => {
    expect(saveOrder(rule('cpu'), 90, 95)).toEqual(['enter', 'clear']);
    expect(saveOrder(rule('cpu'), 90, 70)).toEqual(['clear', 'enter']);
    expect(saveOrder(rule('battery'), 15, 10)).toEqual(['enter', 'clear']);
    expect(saveOrder(rule('battery'), 15, 30)).toEqual(['clear', 'enter']);
  });
});
