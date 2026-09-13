/**
 * Regression tests for the phone-number field layout.
 *
 * THE BUG THESE PIN
 *
 * On a Redmi Note 8 (360dp wide) the phone input extended past the right edge
 * of the screen. Three independent causes, all in one row:
 *
 *   1. The country codes were rendered with the shared <Button>, which defaults
 *      to `fullWidth: true` -> `width: '100%'`. TWO of them in a flex row each
 *      demanded the full row width.
 *   2. The <TextInput> had `flex: 1` but no `minWidth: 0`. In React Native, as
 *      on the web, flex alone does not permit a child to shrink below its
 *      content width.
 *   3. 24dp of screen padding plus 48dp of card padding leaves roughly 288dp of
 *      usable width, which the two padded 54dp-tall buttons already exceeded.
 *
 * The row could therefore only grow, and it grew past the viewport.
 *
 * These are static assertions against the real component source. A full render
 * test would need a React Native test renderer, which this workspace does not
 * have; asserting the style contract catches every regression that caused the
 * original defect without pretending to be a device test.
 *
 * Run: node scripts/run-unit-tests.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(dirname, '..', '..', '..', '..');

const FIELD = path.join(REPO_ROOT, 'packages/ui/src/components/PhoneNumberField.tsx');
const fieldSource = fs.readFileSync(FIELD, 'utf8');

/**
 * The same source with comments removed.
 *
 * The header comment quotes the OLD broken markup (`<Button`) to explain the
 * bug, so a naive search hits it. Assertions about what the code DOES must look
 * at code only.
 */
const fieldCode = fieldSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SCREENS = [
  ['passenger', 'apps/passenger-app/src/features/auth/screens/PhoneLoginScreen.tsx'],
  ['driver', 'apps/driver-app/src/features/auth/screens/PhoneLoginScreen.tsx'],
];

describe('the input can actually shrink', () => {
  test('minWidth: 0 is present - flex alone is not enough', () => {
    // Cause #2. Without this the input refuses to go below its content width
    // and pushes the row past the screen edge.
    assert.match(fieldSource, /minWidth: 0/);
  });

  test('the input grows AND shrinks from a zero basis', () => {
    assert.match(fieldSource, /flexGrow: 1/);
    assert.match(fieldSource, /flexShrink: 1/);
    assert.match(fieldSource, /flexBasis: 0/);
  });
});

describe('the country selector is bounded', () => {
  test('it does not use the full-width shared Button', () => {
    // Cause #1. Two width:100% buttons in one row cannot fit by definition.
    assert.doesNotMatch(fieldCode, /<Button/);
    assert.match(fieldCode, /<Pressable/);
  });

  test('the code group cannot grow to consume the row', () => {
    assert.match(fieldSource, /flexGrow: 0/);
    assert.match(fieldSource, /flexShrink: 0/);
  });

  test('each chip has a bounded, not fixed-large, width', () => {
    // Wide enough to tap (>=48dp target) but small enough to leave room.
    assert.match(fieldSource, /minWidth: 64/);
    assert.match(fieldSource, /minHeight: 48/);
  });
});

describe('the row never exceeds its container', () => {
  test('the row is capped at the parent width', () => {
    assert.match(fieldSource, /width: '100%'/);
  });

  test('it wraps rather than overflowing when genuinely too narrow', () => {
    // Large font scaling or split-screen: wrapping is ugly, overflow is broken.
    assert.match(fieldSource, /flexWrap: 'wrap'/);
  });

  test('no screen-width calculation is used', () => {
    // Dimensions.get('window') ignores the padding of every ancestor, which is
    // exactly how these bugs are usually "fixed" and then reappear inside a card.
    assert.doesNotMatch(fieldSource, /Dimensions\.get/);
    assert.doesNotMatch(fieldSource, /useWindowDimensions/);
  });
});

describe('RTL is handled deliberately', () => {
  test('the row direction follows the locale', () => {
    assert.match(fieldSource, /I18nManager\.isRTL/);
    assert.match(fieldSource, /row-reverse/);
  });

  test('the digits themselves stay LTR', () => {
    // A phone number read right-to-left is a different number to the eye, and
    // the country code would sit against the wrong end.
    assert.match(fieldSource, /writingDirection: 'ltr'/);
    assert.match(fieldSource, /textAlign: 'left'/);
  });

  test('writingDirection is a style, not a prop', () => {
    // It is a style property in React Native; as a TextInput prop it fails
    // typecheck, which is how this was caught.
    const propUsage = /writingDirection=["{]/;
    assert.doesNotMatch(fieldCode, propUsage);
  });
});

describe('phone-appropriate input settings', () => {
  test('numeric keypad and telephone semantics', () => {
    assert.match(fieldSource, /keyboardType="phone-pad"/);
    assert.match(fieldSource, /inputMode="tel"/);
    assert.match(fieldSource, /autoComplete="tel"/);
    assert.match(fieldSource, /textContentType="telephoneNumber"/);
  });

  test('a sensible max length', () => {
    assert.match(fieldSource, /maxLength=\{15\}/);
  });

  test('the input and each country chip are labelled for screen readers', () => {
    assert.match(fieldSource, /accessibilityLabel=\{accessibilityLabel\}/);
    assert.match(fieldSource, /accessibilityRole="button"/);
    assert.match(fieldSource, /accessibilityState=\{\{ selected, disabled \}\}/);
  });
});

describe('both screens use the shared field and handle the keyboard', () => {
  for (const [app, relPath] of SCREENS) {
    const source = fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');

    test(`${app}: uses the shared PhoneNumberField`, () => {
      assert.match(source, /<PhoneNumberField/);
    });

    test(`${app}: the old overflowing row is gone`, () => {
      // The exact markup that overflowed.
      assert.doesNotMatch(source, /styles\.codePicker/);
      assert.doesNotMatch(source, /<View style=\{\[styles\.row, isRTL && styles\.rowReverse\]\}>/);
    });

    test(`${app}: the focused input stays visible when the keyboard opens`, () => {
      assert.match(source, /KeyboardAvoidingView/);
      assert.match(source, /ScrollView/);
    });

    test(`${app}: taps still register while the keyboard is up`, () => {
      // Without this the first tap on "send code" only dismisses the keyboard.
      assert.match(source, /keyboardShouldPersistTaps="handled"/);
    });

    test(`${app}: content centres when short and scrolls when tall`, () => {
      // flexGrow, not flex: 1 - the latter would stop it scrolling.
      assert.match(source, /scrollContent: \{ flexGrow: 1/);
    });

    test(`${app}: a long error message cannot widen the card`, () => {
      assert.match(source, /error: \{[^}]*flexShrink: 1/);
      assert.match(source, /card: \{[^}]*width: '100%'/);
    });

    test(`${app}: SafeArea is still respected via ScreenContainer`, () => {
      assert.match(source, /<ScreenContainer/);
    });
  }
});
