import { assertEquals, assertThrows } from '@std/assert';
import {
  ensureInteractivePromptAvailable,
  shouldPromptForCostConfirmation,
} from '../src/commands/sync.ts';

Deno.test('shouldPromptForCostConfirmation returns true only when confirm-cost is enabled and --yes is not set', () => {
  assertEquals(shouldPromptForCostConfirmation({ confirmCost: true, yes: false }), true);
  assertEquals(shouldPromptForCostConfirmation({ confirmCost: false, yes: false }), false);
  assertEquals(shouldPromptForCostConfirmation({ confirmCost: true, yes: true }), false);
});

Deno.test('ensureInteractivePromptAvailable throws in non-interactive environments', () => {
  assertThrows(
    () => ensureInteractivePromptAvailable(false),
    Error,
    'Cost confirmation requires an interactive terminal',
  );
});

Deno.test('ensureInteractivePromptAvailable passes in interactive environments', () => {
  ensureInteractivePromptAvailable(true);
});
