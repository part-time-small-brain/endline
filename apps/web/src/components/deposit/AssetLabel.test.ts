import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CHAIN_ORDER } from "../../lib/depositMenu.ts";
import { ChainLabel } from "./AssetLabel.tsx";

it("gives every named deposit network a logo instead of the letter fallback", () => {
  expect(CHAIN_ORDER.filter((code) => !renderToStaticMarkup(createElement(ChainLabel, { code })).includes("<img"))).toEqual([]);
});
