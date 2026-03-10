"use client";

import React, { useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

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

// US Atlas TopoJSON - includes all states
const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

// FIPS code to state abbreviation mapping
const FIPS_TO_STATE: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA",
  "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN",
  "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
  "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
  "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
  "56": "WY", "72": "PR",
};

export function USHeatMap({ data }: USHeatMapProps) {
  const [hoveredState, setHoveredState] = useState<StateData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const stateDataMap = new Map(data.map(s => [s.stateCode, s]));
  const maxOrders = Math.max(...data.map(s => s.orderCount), 1);

  const getStateColor = (stateCode: string) => {
    const stateData = stateDataMap.get(stateCode);
    if (!stateData || stateData.orderCount === 0) return "#334155"; // slate-700

    const intensity = stateData.orderCount / maxOrders;
    // Rose color gradient
    if (intensity < 0.15) return "#881337"; // rose-900
    if (intensity < 0.3) return "#9f1239"; // rose-800
    if (intensity < 0.45) return "#be123c"; // rose-700
    if (intensity < 0.6) return "#e11d48"; // rose-600
    if (intensity < 0.75) return "#f43f5e"; // rose-500
    return "#fb7185"; // rose-400
  };

  return (
    <div className="relative">
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 1000 }}
        style={{ width: "100%", height: "auto" }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const fips = geo.id;
              const stateCode = FIPS_TO_STATE[fips] || "";
              const stateData = stateDataMap.get(stateCode);
              const isHovered = hoveredState?.stateCode === stateCode;

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getStateColor(stateCode)}
                  stroke={isHovered ? "#fff" : "#64748b"}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: getStateColor(stateCode), filter: "brightness(1.2)" },
                    pressed: { outline: "none" },
                  }}
                  onMouseEnter={(e) => {
                    if (stateData) {
                      setHoveredState(stateData);
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    }
                  }}
                  onMouseLeave={() => setHoveredState(null)}
                />
              );
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Tooltip */}
      {hoveredState && (
        <div className="absolute top-4 right-4 bg-slate-800 border border-slate-600 rounded-lg p-3 shadow-xl min-w-[180px] z-10">
          <p className="text-white font-semibold text-base">{hoveredState.state}</p>
          <div className="mt-2 space-y-1.5 text-sm">
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
              <span className="text-emerald-400 font-medium">{hoveredState.kitRate}%</span>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 mt-4">
        <span className="text-xs text-slate-400">Fewer orders</span>
        <div className="flex h-3 rounded overflow-hidden">
          <div className="w-6" style={{ backgroundColor: "#334155" }} />
          <div className="w-6" style={{ backgroundColor: "#881337" }} />
          <div className="w-6" style={{ backgroundColor: "#9f1239" }} />
          <div className="w-6" style={{ backgroundColor: "#be123c" }} />
          <div className="w-6" style={{ backgroundColor: "#e11d48" }} />
          <div className="w-6" style={{ backgroundColor: "#f43f5e" }} />
          <div className="w-6" style={{ backgroundColor: "#fb7185" }} />
        </div>
        <span className="text-xs text-slate-400">More orders</span>
      </div>
    </div>
  );
}
