import abstract from "../../assets/chains/abstract.svg";
import aptos from "../../assets/chains/aptos.svg";
import arbitrum from "../../assets/chains/arbitrum.svg";
import avalanche from "../../assets/chains/avalanche.svg";
import base from "../../assets/chains/base.svg";
import bitcoin from "../../assets/chains/bitcoin.svg";
import bnb from "../../assets/chains/bnb.svg";
import ethereum from "../../assets/chains/ethereum.svg";
import gnosis from "../../assets/chains/gnosis.svg";
import miden from "../../assets/chains/miden.svg";
import monad from "../../assets/chains/monad.svg";
import optimism from "../../assets/chains/optimism.svg";
import polygon from "../../assets/chains/polygon.svg";
import robinhood from "../../assets/chains/robinhood.svg";
import scroll from "../../assets/chains/scroll.svg";
import solana from "../../assets/chains/solana.svg";
import sui from "../../assets/chains/sui.svg";
import ton from "../../assets/chains/ton.svg";
import tron from "../../assets/chains/tron.svg";
import xlayer from "../../assets/chains/xlayer.svg";
import usdc from "../../assets/tokens/usdc.svg";
import usdt from "../../assets/tokens/usdt.svg";
import { chainName } from "../../lib/depositMenu.ts";

const CHAIN_LOGOS: Record<string, string> = { base, arb: arbitrum, op: optimism, sol: solana, pol: polygon, bsc: bnb, avax: avalanche, eth: ethereum, btc: bitcoin, tron, gnosis, sui, aptos, abs: abstract, hood: robinhood, scroll, xlayer, monad, ton, miden };
const TOKEN_LOGOS: Record<string, string> = { USDC: usdc, USDT: usdt, ETH: ethereum, BTC: bitcoin, SOL: solana };

function AssetLabel({ logo, name, layout }: { logo: string | undefined; name: string; layout: string }) {
  return (
    <span className={`flex items-center ${layout}`}>
      {logo ? (
        <img src={logo} alt="" className="size-5 shrink-0" />
      ) : (
        <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-paper text-[11px] font-semibold text-ink-2">
          {name.charAt(0)}
        </span>
      )}
      {name}
    </span>
  );
}

export const TokenLabel = ({ symbol }: { symbol: string }) => <AssetLabel logo={TOKEN_LOGOS[symbol]} name={symbol} layout="flex-col gap-1 px-1" />;
export const ChainLabel = ({ code }: { code: string }) => <AssetLabel logo={CHAIN_LOGOS[code]} name={chainName(code)} layout="gap-2" />;
