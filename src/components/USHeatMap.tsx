"use client";

import React, { useState } from "react";

interface StateData {
  stateCode: string;
  state: string;
  orderCount: number;
  totalUnits: number;
  kitRate: number;
}

interface USHeatMapProps {
  data: StateData[];
}

// SVG paths for US states (simplified for common states)
const STATE_PATHS: Record<string, string> = {
  AL: "M628,401 L631,447 L588,452 L585,406 Z",
  AK: "M158,509 L100,509 L80,540 L120,560 L180,540 Z",
  AZ: "M205,340 L260,340 L270,420 L200,420 Z",
  AR: "M520,370 L575,370 L575,420 L520,420 Z",
  CA: "M120,240 L175,240 L200,420 L110,380 Z",
  CO: "M290,290 L380,290 L380,360 L290,360 Z",
  CT: "M793,210 L820,205 L825,230 L795,235 Z",
  DE: "M765,265 L780,260 L785,290 L770,295 Z",
  FL: "M640,440 L720,420 L740,520 L680,520 L640,480 Z",
  GA: "M640,380 L690,370 L700,440 L640,450 Z",
  HI: "M260,515 L310,500 L330,530 L280,540 Z",
  ID: "M200,150 L260,140 L270,270 L210,280 Z",
  IL: "M560,250 L590,250 L595,340 L555,345 Z",
  IN: "M595,260 L630,255 L635,335 L598,340 Z",
  IA: "M480,230 L555,225 L560,285 L485,290 Z",
  KS: "M380,310 L480,305 L480,365 L380,370 Z",
  KY: "M590,320 L680,300 L685,350 L595,365 Z",
  LA: "M520,430 L575,425 L580,490 L530,500 Z",
  ME: "M815,100 L840,95 L850,170 L820,175 Z",
  MD: "M720,270 L770,260 L775,295 L725,305 Z",
  MA: "M795,185 L840,175 L845,200 L800,210 Z",
  MI: "M580,150 L640,140 L655,230 L590,240 Z",
  MN: "M470,130 L545,120 L555,215 L480,225 Z",
  MS: "M575,380 L610,375 L615,455 L580,460 Z",
  MO: "M480,295 L560,290 L565,375 L485,380 Z",
  MT: "M215,100 L340,90 L350,180 L225,190 Z",
  NE: "M340,240 L445,235 L450,300 L345,305 Z",
  NV: "M165,220 L220,215 L235,340 L175,350 Z",
  NH: "M800,140 L820,135 L825,185 L805,190 Z",
  NJ: "M770,225 L790,220 L795,275 L775,280 Z",
  NM: "M270,350 L350,345 L355,440 L275,445 Z",
  NY: "M720,160 L800,150 L805,230 L730,240 Z",
  NC: "M655,330 L760,310 L770,365 L665,380 Z",
  ND: "M355,120 L445,115 L450,180 L360,185 Z",
  OH: "M635,245 L695,235 L700,310 L640,320 Z",
  OK: "M365,365 L475,355 L480,420 L370,430 Z",
  OR: "M115,140 L200,130 L210,220 L125,230 Z",
  PA: "M695,220 L770,210 L775,265 L700,275 Z",
  RI: "M810,200 L825,195 L828,215 L813,220 Z",
  SC: "M675,365 L730,355 L740,405 L685,415 Z",
  SD: "M355,180 L445,175 L450,245 L360,250 Z",
  TN: "M560,345 L680,330 L685,375 L565,390 Z",
  TX: "M320,390 L475,370 L510,530 L350,540 L300,460 Z",
  UT: "M230,240 L295,235 L300,340 L235,345 Z",
  VT: "M785,130 L805,125 L810,175 L790,180 Z",
  VA: "M680,290 L765,275 L775,330 L690,345 Z",
  WA: "M130,80 L210,70 L220,145 L140,155 Z",
  WV: "M680,280 L720,270 L730,325 L690,335 Z",
  WI: "M535,150 L590,145 L600,235 L545,240 Z",
  WY: "M270,190 L355,185 L360,265 L275,270 Z",
  DC: "M745,285 L755,282 L757,295 L747,298 Z",
};

export function USHeatMap({ data }: USHeatMapProps) {
  const [hoveredState, setHoveredState] = useState<StateData | null>(null);

  const stateDataMap = new Map(data.map(s => [s.stateCode, s]));
  const maxOrders = Math.max(...data.map(s => s.orderCount), 1);

  const getStateColor = (stateCode: string) => {
    const stateData = stateDataMap.get(stateCode);
    if (!stateData) return "#1e293b"; // slate-800

    const intensity = stateData.orderCount / maxOrders;
    // Rose color gradient: from slate-700 to rose-500
    if (intensity === 0) return "#334155";
    if (intensity < 0.2) return "#9f1239"; // rose-800
    if (intensity < 0.4) return "#be123c"; // rose-700
    if (intensity < 0.6) return "#e11d48"; // rose-600
    if (intensity < 0.8) return "#f43f5e"; // rose-500
    return "#fb7185"; // rose-400
  };

  return (
    <div className="relative">
      <svg viewBox="50 50 820 520" className="w-full h-auto">
        {/* Background */}
        <rect x="50" y="50" width="820" height="520" fill="#0f172a" />

        {/* State paths */}
        {Object.entries(STATE_PATHS).map(([stateCode, path]) => {
          const stateData = stateDataMap.get(stateCode);
          return (
            <path
              key={stateCode}
              d={path}
              fill={getStateColor(stateCode)}
              stroke="#475569"
              strokeWidth="1"
              className="transition-all duration-200 cursor-pointer hover:brightness-125"
              onMouseEnter={() => stateData && setHoveredState(stateData)}
              onMouseLeave={() => setHoveredState(null)}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoveredState && (
        <div className="absolute top-4 right-4 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-lg min-w-[160px]">
          <p className="text-white font-medium">{hoveredState.state}</p>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">Orders:</span>
              <span className="text-white font-medium">{hoveredState.orderCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Units:</span>
              <span className="text-white">{hoveredState.totalUnits}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Kit Rate:</span>
              <span className="text-emerald-400">{hoveredState.kitRate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-2 mt-4">
        <span className="text-xs text-slate-400">Low</span>
        <div className="flex h-3 rounded overflow-hidden">
          <div className="w-6 bg-slate-700" />
          <div className="w-6 bg-rose-800" />
          <div className="w-6 bg-rose-700" />
          <div className="w-6 bg-rose-600" />
          <div className="w-6 bg-rose-500" />
          <div className="w-6 bg-rose-400" />
        </div>
        <span className="text-xs text-slate-400">High</span>
      </div>
    </div>
  );
}
