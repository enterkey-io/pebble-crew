import { expect, it } from 'vitest';
// The same AST inspector is executed by check:ui against production screens.
// @ts-expect-error The build-time JavaScript helper has no runtime application declaration.
import { sourceContract } from '../../../scripts/ui-source-contract.mjs';
it('requires a rendered imported component, not a name in a comment or unused import', () => {
  const imported = "import { ReportingField as Reporting } from './ui/pebble-profile-fields';";
  expect(
    sourceContract(
      imported + 'export function Screen() { return <div>{/* <ReportingField /> */}</div>; }',
    ).renders('ReportingField', './ui/pebble-profile-fields'),
  ).toBe(false);
  expect(
    sourceContract(imported + 'export function Screen() { return <Reporting />; }').renders(
      'ReportingField',
      './ui/pebble-profile-fields',
    ),
  ).toBe(true);
});
it('finds unsupported raw profile operations without matching comments', () => {
  expect(
    sourceContract(
      "// client.invoke('agent.onboard')\nclient.invoke('workspace.describe', {});",
    ).rawOperations(),
  ).toEqual(['workspace.describe']);
});

it('rejects an unused helper, namespace internal import and fake reducer owner', () => {
  expect(
    sourceContract(
      "import { ReportingField } from './ui/pebble-profile-fields'; function unused() { return <ReportingField />; } export function Screen() { return <div />; }",
    ).renders('ReportingField', './ui/pebble-profile-fields'),
  ).toBe(false);
  expect(sourceContract("import * as old from './workspace';").unsupportedImports()).toEqual([
    './workspace',
  ]);
  expect(
    sourceContract(
      "client.invoke(flag ? 'agent.onboard' : 'workspace.describe', {});",
    ).rawOperations(),
  ).toEqual(['agent.onboard', 'workspace.describe']);
  expect(
    sourceContract(
      "import {useReducer} from './fake'; import {profileReducer} from './profiles/edit-session'; export function Screen() { useReducer(profileReducer); return <div />; }",
    ).ownsProfileSession(),
  ).toBe(false);
});

it('follows a rendered React memo view without accepting unused or fake memo helpers', () => {
  const component =
    "import { Message } from './message'; const Row = memo(function Row() { return <Message />; });";
  expect(
    sourceContract(
      "import { memo } from 'react';" + component + 'export function Screen() { return <Row />; }',
    ).renders('Message', './message'),
  ).toBe(true);
  expect(
    sourceContract(
      "import { memo } from 'react';" + component + 'export function Screen() { return <div />; }',
    ).renders('Message', './message'),
  ).toBe(false);
  expect(
    sourceContract(
      "import { memo } from './fake';" + component + 'export function Screen() { return <Row />; }',
    ).renders('Message', './message'),
  ).toBe(false);
});
