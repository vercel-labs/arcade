import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { layout, type Node } from '../../tui/index.ts';
import type { ArcadeModelCatalog } from '../match/team-model-catalog.ts';
import { buildGatewayNoticePill, catalogAccessLine, gatewayNoticeFor, gatewayNoticeSentence } from './gateway-notice.ts';

function catalog(overrides: Partial<ArcadeModelCatalog> = {}): ArcadeModelCatalog {
  return { source: 'team', textCreators: [], realtimeCreators: [], planRestrictedCount: 0, ...overrides };
}

function texts(root: Node): string[] {
  return [...(root.text ? [root.text] : []), ...(root.children ?? []).flatMap(texts)];
}

describe('gateway notice', () => {
  test('signed out always asks to sign in, whatever the catalog says', () => {
    assert.equal(gatewayNoticeFor(false, null)?.kind, 'sign-in');
    assert.equal(gatewayNoticeFor(false, catalog({ requestAvailability: { status: 'unavailable', reason: 'insufficient_funds' } }))?.kind, 'sign-in');
  });

  test('signed in, only a confident unavailable verdict with a known reason shows a notice', () => {
    assert.equal(gatewayNoticeFor(true, null), null);
    assert.equal(gatewayNoticeFor(true, catalog()), null);
    assert.equal(gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'available' } })), null);
    assert.equal(gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unknown', reason: 'billing_state_unresolved' } })), null);
    assert.equal(gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unavailable', reason: 'team_blocked' } })), null);
    assert.equal(gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unavailable', reason: 'customer_verification_required' } }))?.kind, 'add-card');
    assert.equal(gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unavailable', reason: 'insufficient_funds' } }))?.kind, 'buy-credits');
  });

  test('the setup-panel sentence names the product the pill title already carries', () => {
    const notice = gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unavailable', reason: 'customer_verification_required' } }))!;
    assert.match(notice.title!, /AI Gateway/);
    assert.doesNotMatch(`${notice.lead} ${notice.rest}`, /AI Gateway/);
    assert.match(gatewayNoticeSentence(notice), /free monthly AI Gateway credits/);
  });

  test('the account line reports hidden models only for a team catalog', () => {
    assert.equal(catalogAccessLine(null), null);
    assert.equal(catalogAccessLine(catalog({ source: 'fallback' })), null);
    assert.deepEqual(catalogAccessLine(catalog()), { text: 'all models available to this team' });
    const restricted = catalogAccessLine(catalog({ planRestrictedCount: 12 }))!;
    assert.equal(restricted.text, '12 more models with paid credits');
    assert.ok(restricted.url);
    assert.equal(catalogAccessLine(catalog({ planRestrictedCount: 1 }))!.text, '1 more model with paid credits');
  });

  test('the pill sheds the tail of its sentence before colliding with the menu button, and never truncates', () => {
    const notice = gatewayNoticeFor(true, catalog({ requestAvailability: { status: 'unavailable', reason: 'customer_verification_required' } }))!;
    const opts = { onAction: () => {}, onDismiss: () => {} };
    const wide = buildGatewayNoticePill(notice, { ...opts, maxWidth: 140 })!;
    layout(wide, { x: 0, y: 0, w: 140, h: 1 });
    assert.deepEqual(texts(wide), [notice.title, notice.lead, ` ${notice.rest}`, '✕']);
    assert.ok(wide.layout!.w <= 140);
    assert.equal(wide.layout!.h, 1);

    const narrow = buildGatewayNoticePill(notice, { ...opts, maxWidth: 60 })!;
    layout(narrow, { x: 0, y: 0, w: 60, h: 1 });
    assert.deepEqual(texts(narrow), [notice.title, notice.lead, '✕']);
    assert.ok(narrow.layout!.w <= 60, `pill ${narrow.layout!.w} wide overflows 60`);

    assert.equal(buildGatewayNoticePill(notice, { ...opts, maxWidth: 30 }), null);

    const signIn = buildGatewayNoticePill(gatewayNoticeFor(false, null)!, { ...opts, maxWidth: 140 })!;
    assert.deepEqual(texts(signIn), ['sign in', ' to play AI matches', '✕']);
  });
});
