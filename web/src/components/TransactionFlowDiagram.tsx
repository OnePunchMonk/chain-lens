import React, { useMemo } from 'react';
import { formatSats, short, scriptTypeColor } from '../utils/api';

interface Vin {
  txid: string;
  vout: number;
  prevout?: { value_sats: number };
  script_type: string;
  address?: string;
}

interface Vout {
  n: number;
  value_sats: number;
  script_type: string;
  address?: string;
  op_return_data_utf8?: string | null;
}

interface Props {
  vin: Vin[];
  vout: Vout[];
  totalInput: number;
  totalOutput: number;
  feeSats: number;
}

/** SVG-based transaction flow diagram: inputs → fee → outputs */
export function TransactionFlowDiagram({ vin, vout, totalInput, totalOutput, feeSats }: Props) {
  const NODE_W = 160;
  const NODE_H = 72;
  const GAP = 24;
  const CENTER_W = 100;
  const PADDING = 20;

  const inputNodes = useMemo(() => {
    return vin.map((v, i) => ({
      y: PADDING + i * (NODE_H + GAP) + NODE_H / 2,
      value: v.prevout?.value_sats ?? 0,
      label: v.address ? short(v.address, 8) : `Input #${i}`,
      type: v.script_type,
    }));
  }, [vin]);

  const outputNodes = useMemo(() => {
    return vout.map((v, i) => ({
      y: PADDING + i * (NODE_H + GAP) + NODE_H / 2,
      value: v.value_sats,
      label: v.script_type === 'op_return'
        ? 'OP_RETURN'
        : v.address ? short(v.address, 8) : `Output #${v.n}`,
      type: v.script_type,
    }));
  }, [vout]);

  const maxNodes = Math.max(inputNodes.length, outputNodes.length, 1);
  if (maxNodes === 0) return null;
  const leftColX = NODE_W / 2 + PADDING;
  const centerX = NODE_W + PADDING + CENTER_W / 2 + GAP;
  const rightColX = NODE_W + PADDING + CENTER_W + GAP * 2 + NODE_W / 2;
  const svgW = NODE_W * 2 + CENTER_W + GAP * 2 + PADDING * 2;
  const svgH = maxNodes * (NODE_H + GAP) - GAP + PADDING * 2;

  const centerY = svgH / 2;

  const inputTotal = inputNodes.reduce((s, n) => s + n.value, 0);
  const outputTotal = outputNodes.reduce((s, n) => s + n.value, 0);

  return (
    <div className="tx-flow-diagram">
      <svg
        width="100%"
        viewBox={`0 0 ${svgW} ${svgH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ maxHeight: Math.min(svgH, 420) }}
      >
        <defs>
          <linearGradient id="flowGradIn" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(213, 94%, 58%)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="hsl(213, 94%, 58%)" stopOpacity="0.3" />
          </linearGradient>
          <linearGradient id="flowGradOut" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(142, 71%, 45%)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(142, 71%, 45%)" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="flowGradFee" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(37, 92%, 55%)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="hsl(37, 92%, 55%)" stopOpacity="0.9" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="hsl(224, 10%, 55%)" />
          </marker>
        </defs>

        {/* Flow paths: inputs → center */}
        {inputNodes.map((node, i) => {
          const ctrlX = leftColX + (centerX - leftColX) / 2;
          const path = `M ${leftColX} ${node.y} C ${ctrlX} ${node.y}, ${ctrlX} ${centerY}, ${centerX - CENTER_W / 2} ${centerY}`;
          const weight = inputTotal > 0 ? (node.value / inputTotal) * 3 : 1;
          return (
            <path
              key={`in-${i}`}
              d={path}
              fill="none"
              stroke="url(#flowGradIn)"
              strokeWidth={Math.max(2, Math.min(12, weight * 8))}
              strokeLinecap="round"
              strokeOpacity="0.6"
              className="flow-path flow-path-in"
            />
          );
        })}

        {/* Flow paths: center → outputs */}
        {outputNodes.map((node, i) => {
          if (node.type === 'op_return') return null;
          const ctrlX = centerX + (rightColX - centerX) / 2;
          const path = `M ${centerX + CENTER_W / 2} ${centerY} C ${ctrlX} ${centerY}, ${ctrlX} ${node.y}, ${rightColX} ${node.y}`;
          const weight = outputTotal > 0 ? (node.value / outputTotal) * 3 : 1;
          return (
            <path
              key={`out-${i}`}
              d={path}
              fill="none"
              stroke="url(#flowGradOut)"
              strokeWidth={Math.max(2, Math.min(12, weight * 8))}
              strokeLinecap="round"
              strokeOpacity="0.6"
              className="flow-path flow-path-out"
            />
          );
        })}

        {/* Input nodes */}
        <g className="flow-nodes flow-nodes-in">
          {inputNodes.map((node, i) => (
            <g key={i} transform={`translate(${leftColX - NODE_W / 2}, ${node.y - NODE_H / 2})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="10"
                ry="10"
                className="flow-node flow-node-in"
                filter="url(#glow)"
              />
              <text x={NODE_W / 2} y={22} textAnchor="middle" className="flow-node-value">
                {node.value ? formatSats(node.value) : '?'}
              </text>
              <text x={NODE_W / 2} y={38} textAnchor="middle" className="flow-node-label">
                {node.label}
              </text>
              <text x={NODE_W / 2} y={54} textAnchor="middle" className="flow-node-type">
                {node.type}
              </text>
            </g>
          ))}
        </g>

        {/* Center fee node */}
        <g transform={`translate(${centerX - CENTER_W / 2}, ${centerY - 36})`}>
          <rect
            width={CENTER_W}
            height={72}
            rx="12"
            ry="12"
            className="flow-node flow-node-fee"
          />
          <text x={CENTER_W / 2} y={28} textAnchor="middle" className="flow-node-fee-title">
            Miner Fee
          </text>
          <text x={CENTER_W / 2} y={52} textAnchor="middle" className="flow-node-fee-value">
            {formatSats(feeSats)}
          </text>
        </g>

        {/* Output nodes */}
        <g className="flow-nodes flow-nodes-out">
          {outputNodes.map((node, i) => (
            <g key={i} transform={`translate(${rightColX - NODE_W / 2}, ${node.y - NODE_H / 2})`}>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx="10"
                ry="10"
                className={`flow-node flow-node-out ${node.type === 'op_return' ? 'flow-node-opreturn' : ''}`}
                filter="url(#glow)"
              />
              <text x={NODE_W / 2} y={22} textAnchor="middle" className="flow-node-value">
                {node.type === 'op_return' ? 'OP_RETURN' : formatSats(node.value)}
              </text>
              <text x={NODE_W / 2} y={38} textAnchor="middle" className="flow-node-label">
                {node.label}
              </text>
              <text x={NODE_W / 2} y={54} textAnchor="middle" className="flow-node-type">
                {node.type}
              </text>
            </g>
          ))}
        </g>

        {/* Labels */}
        <text x={leftColX} y={14} textAnchor="middle" className="flow-col-label">
          Inputs ({vin.length})
        </text>
        <text x={rightColX} y={14} textAnchor="middle" className="flow-col-label">
          Outputs ({vout.length})
        </text>
      </svg>

      {/* Legend bar */}
      <div className="flow-legend">
        <span>
          <span className="flow-legend-dot flow-legend-in" /> In:{' '}
          <strong>{formatSats(totalInput)}</strong>
        </span>
        <span>
          <span className="flow-legend-dot flow-legend-fee" /> Fee:{' '}
          <strong>{formatSats(feeSats)}</strong>
        </span>
        <span>
          <span className="flow-legend-dot flow-legend-out" /> Out:{' '}
          <strong>{formatSats(outputTotal)}</strong>
        </span>
      </div>
    </div>
  );
}
