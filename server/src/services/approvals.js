import { numSetting } from './settings.js';
import { nowStr } from '../util.js';

/**
 * Staged approvals: the authority at position `seq` (0 = primary) sees a pending request once
 *   seq <= escalated_seq (sent on manually by an admin)  OR  created_at + seq × escalationMinutes <= now.
 * Returns SQL + params to drop into a WHERE clause.
 */
export async function visibleCond(pa = 'pa', g = 'g') {
  const mins = await numSetting('approval.escalationMinutes');
  return {
    sql: `(${pa}.seq <= ${g}.escalated_seq OR TIMESTAMPADD(MINUTE, ${pa}.seq * ?, ${g}.created_at) <= ?)`,
    params: [mins, nowStr()],
    mins,
  };
}
