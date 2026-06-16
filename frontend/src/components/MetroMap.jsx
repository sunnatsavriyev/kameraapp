import React, { useState, useEffect, useRef } from "react";

export default function MetroMap({ apiStations, onStationSelect, selectedStationId, t }) {
  const [selectedStationKey, setSelectedStationKey] = useState(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  // Sync selected station from parent props
  useEffect(() => {
    if (selectedStationId && apiStations.length > 0) {
      const activeStation = apiStations.find(s => s.id === selectedStationId);
      if (activeStation) {
        // Find matching key in local coordinates
        const key = Object.keys(stations).find(
          k => stations[k].name.toLowerCase() === activeStation.name.toLowerCase() ||
               activeStation.name.toLowerCase().includes(stations[k].name.toLowerCase())
        );
        if (key) {
          setSelectedStationKey(key);
        }
      }
    } else if (!selectedStationId) {
      setSelectedStationKey(null);
    }
  }, [selectedStationId, apiStations]);

  // Coordinates matching the original design with layout adjustments to avoid overlaps
  const stations = {
    // Blue Line
    "beruniy": { x: 100, y: 45, name: "Beruniy", line: "blue" },
    "tinchlik": { x: 100, y: 130, name: "Tinchlik", line: "blue" },
    "chorsu": { x: 100, y: 200, name: "Chorsu", line: "blue" },
    "gafur_gulom": { x: 180, y: 280, name: "G'afur G'ulom", line: "blue" },
    "alisher_navoiy": { x: 260, y: 360, name: "Alisher Navoiy", line: "blue", transfer: ["red"], dx: 14, dy: 4, textAnchor: "start" },
    "ozbekiston": { x: 270, y: 470, name: "O'zbekiston", line: "blue", dx: 14, dy: 4, textAnchor: "start" },
    "kosmonavtlar": { x: 350, y: 550, name: "Kosmonavtlar", line: "blue", dx: 0, dy: 20, textAnchor: "middle" },
    "oybek": { x: 500, y: 550, name: "Oybek", line: "blue", transfer: ["green"], dx: 0, dy: 20, textAnchor: "middle" },
    "toshkent": { x: 700, y: 555, name: "Toshkent", line: "blue", dx: -14, dy: -8, textAnchor: "end" },
    "mashinasozlar": { x: 700, y: 605, name: "Mashinasozlar", line: "blue", dx: -14, dy: 4, textAnchor: "end" },
    "dostlik": { x: 700, y: 640, name: "Do'stlik", line: "blue", transfer: ["yellow"], dx: -14, dy: -8, textAnchor: "end" },

    // Green Line
    "turkiston": { x: 500, y: 50, name: "Turkiston", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "yunusobod": { x: 500, y: 100, name: "Yunusobod", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "shahriston": { x: 500, y: 150, name: "Shahriston", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "bodomzor": { x: 500, y: 200, name: "Bodomzor", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "minor": { x: 500, y: 250, name: "Minor", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "abdulla_qodiriy": { x: 500, y: 300, name: "Abdulla Qodiriy", line: "green", dx: -14, dy: 4, textAnchor: "end" },
    "yunus_rajabiy": { x: 500, y: 350, name: "Yunus Rajabiy", line: "green", transfer: ["red"], dx: -14, dy: 4, textAnchor: "end" },
    "Mingo'rik": { x: 500, y: 520, name: "Mingo'rik", line: "green", transfer: ["blue"], dx: -14, dy: 4, textAnchor: "end" },

    // Red Line
    "buyuk_ipak": { x: 700, y: 180, name: "Buyuk Ipak Yo'li", line: "red", dx: -14, dy: 4, textAnchor: "end" },
    "pushkin": { x: 700, y: 235, name: "Pushkin", line: "red", dx: -14, dy: 4, textAnchor: "end" },
    "hamid_olimjon": { x: 700, y: 285, name: "Hamid Olimjon", line: "red", dx: -14, dy: 4, textAnchor: "end" },
    "amir_temur_xiyoboni": { x: 500, y: 390, name: "Amir Temur Xiyoboni", line: "red", transfer: ["green"], dx: 16, dy: 4, textAnchor: "start" },
    "mustaqillik_maydoni": { x: 410, y: 390, name: "Mustaqillik Maydoni", line: "red", dx: 0, dy: 20, textAnchor: "middle" },
    "paxtakor": { x: 260, y: 390, name: "Paxtakor", line: "red", transfer: ["blue"], dx: -14, dy: 4, textAnchor: "end" },
    "xalqlar_dostligi": { x: 180, y: 460, name: "Xalqlar Do'stligi", line: "red", dx: -14, dy: 4, textAnchor: "end" },
    "milliy_bog": { x: 150, y: 500, name: "Milliy Bog'", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "novza": { x: 107, y: 550, name: "Novza", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "mirzo_ulugbek": { x: 107, y: 590, name: "Mirzo Ulug'bek", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "chilonzor": { x: 107, y: 630, name: "Chilonzor", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "olmazor": { x: 107, y: 670, name: "Olmazor", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "choshtepa": { x: 107, y: 710, name: "Choshtepa", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "ozgarish": { x: 107, y: 750, name: "O'zgarish", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "sergeli": { x: 107, y: 790, name: "Sergeli", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "yangihayot": { x: 107, y: 830, name: "Yangihayot", line: "red", dx: 14, dy: 4, textAnchor: "start" },
    "chinor": { x: 107, y: 870, name: "Chinor", line: "red", transfer: ["yellow"], dx: 14, dy: 4, textAnchor: "start" },

    // Yellow Line
    "texnopark": { x: 700, y: 660, name: "Texnopark", line: "yellow", transfer: ["blue"], dx: -14, dy: 4, textAnchor: "end" },
    "yashnobod": { x: 700, y: 700, name: "Yashnobod", line: "yellow", dx: -14, dy: 4, textAnchor: "end" },
    "tuzel": { x: 700, y: 740, name: "Tuzel", line: "yellow", dx: -14, dy: 4, textAnchor: "end" },
    "olmos": { x: 700, y: 780, name: "Olmos", line: "yellow", dx: -14, dy: 4, textAnchor: "end" },
    "rohat": { x: 700, y: 820, name: "Rohat", line: "yellow", dx: -14, dy: 4, textAnchor: "end" },
    "yangiobod": { x: 700, y: 860, name: "Yangiobod", line: "yellow", dx: -14, dy: 4, textAnchor: "end" },
    "qoyliq": { x: 650, y: 910, name: "Qo'yliq", line: "yellow", dx: 0, dy: -12, textAnchor: "middle" },
    "malohat": { x: 590, y: 910, name: "Matonat", line: "yellow", dx: 0, dy: 20, textAnchor: "middle" },
    "qiyot": { x: 530, y: 910, name: "Qiyot", line: "yellow", dx: 0, dy: -12, textAnchor: "middle" },
    "tolariq": { x: 440, y: 910, name: "Tolariq", line: "yellow", dx: 0, dy: -12, textAnchor: "middle" },
    "xonobod": { x: 360, y: 910, name: "Xonobod", line: "yellow", dx: 0, dy: 20, textAnchor: "middle" },
    "quruvchilar": { x: 280, y: 910, name: "Quruvchilar", line: "yellow", dx: 0, dy: -12, textAnchor: "middle" },
    "turon": { x: 200, y: 910, name: "Turon", line: "yellow", dx: 0, dy: 20, textAnchor: "middle" },
    "qipchoq": { x: 107, y: 910, name: "Qipchoq", line: "yellow", transfer: ["red"], dx: 0, dy: 20, textAnchor: "middle" },
  };

  const linePaths = [
    // Blue Line
    {
      path: "M 100 45 L 100 130 L 100 200 L 180 280 L 260 360 L 270 430 L 270 550 L 350 550 L 500 550 L 700 555 L 700 605 L 700 640",
      color: "var(--line-blue)",
      name: "Chilonzor Line",
    },
    // Green Line
    {
      path: "M 500 50 L 500 100 L 500 150 L 500 200 L 500 250 L 500 300 L 500 350 L 500 520",
      color: "var(--line-green)",
      name: "Yunusobod Line",
    },
    // Red Line
    {
      path: "M 107 870 L 107 830 L 107 790 L 107 750 L 107 710 L 107 670 L 107 630 L 107 590 L 107 550 L 150 500 L 180 460 L 260 390 L 410 390 L 500 390 L 700 285 L 700 235 L 700 180",
      color: "var(--line-red)",
      name: "O'zbekiston Line",
    },
    // Yellow Line
    {
      path: "M 700 660 L 700 700 L 700 740 L 700 780 L 700 820 L 700 860 L 650 910 L 590 910 L 530 910 L 440 910 L 360 910 L 280 910 L 200 910 L 107 910",
      color: "var(--line-yellow)",
      name: "Circle Line",
    },
  ];

  const findApiStation = (name) => {
    if (!apiStations || apiStations.length === 0) return null;
    return apiStations.find(
      (station) =>
        station.name.toLowerCase() === name.toLowerCase() ||
        station.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(station.name.toLowerCase())
    );
  };

  const handleStationClick = (key, station) => {
    setSelectedStationKey(key);
    const apiStation = findApiStation(station.name);
    if (apiStation) {
      onStationSelect(apiStation.id);
    } else {
      console.warn(`Station "${station.name}" not found in API list.`);
    }
  };

  // Zoom controls
  const zoomIn = () => setScale(prev => Math.min(prev * 1.2, 3));
  const zoomOut = () => setScale(prev => Math.max(prev / 1.2, 0.5));
  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Drag and drop logic
  const handleMouseDown = (e) => {
    if (
      e.target.tagName === "circle" ||
      e.target.tagName === "text" ||
      e.target.closest("g[data-station]")
    ) {
      return;
    }
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e) => {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setScale(prev => Math.min(Math.max(0.5, prev * delta), 3));
  };

  // Touch handlers
  const [touchStart, setTouchStart] = useState({ x: 0, y: 0 });
  const [isTouching, setIsTouching] = useState(false);

  const handleTouchStart = (e) => {
    if (e.target.tagName === "circle" || e.target.tagName === "text") return;
    setIsTouching(true);
    if (e.touches.length === 1) {
      setTouchStart({
        x: e.touches[0].clientX - position.x,
        y: e.touches[0].clientY - position.y,
      });
    }
  };

  const handleTouchMove = (e) => {
    if (!isTouching || e.touches.length !== 1) return;
    setPosition({
      x: e.touches[0].clientX - touchStart.x,
      y: e.touches[0].clientY - touchStart.y,
    });
  };

  const handleTouchEnd = () => {
    setIsTouching(false);
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e) => handleMouseMove(e);
    const handleGlobalMouseUp = () => handleMouseUp();

    if (isDragging) {
      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("mouseup", handleGlobalMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isDragging, dragStart]);

  // Determine active language for line names in the legend
  const isRu = t.title && t.title.includes("Ташкентский");
  const isEn = t.title && t.title.includes("Tashkent Metro");
  const getLineName = (color) => {
    if (color === "blue") return isRu ? "Чиланзарская линия" : isEn ? "Chilonzor Line" : "Chilonzor yo'li";
    if (color === "red") return isRu ? "Узбекистанская линия" : isEn ? "O'zbekiston Line" : "O'zbekiston yo'li";
    if (color === "green") return isRu ? "Юнусабадская линия" : isEn ? "Yunusobod Line" : "Yunusobod yo'li";
    if (color === "yellow") return isRu ? "Кольцевая линия" : isEn ? "Circle Line" : "Halqa yo'li";
    return "";
  };

  return (
    <div className="map-canvas-container" ref={containerRef}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ cursor: isDragging || isTouching ? "grabbing" : "grab" }}
    >
      <div className="map-indicator">
        {t.selectStationFromMap}
      </div>

      <div className="map-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: "var(--line-blue)" }}></span>
          <span>{getLineName("blue")}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: "var(--line-red)" }}></span>
          <span>{getLineName("red")}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: "var(--line-green)" }}></span>
          <span>{getLineName("green")}</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ backgroundColor: "var(--line-yellow)" }}></span>
          <span>{getLineName("yellow")}</span>
        </div>
      </div>

      <div className="map-controls">
        <button className="btn btn-secondary btn-icon" onClick={zoomIn} title="Zoom In">+</button>
        <button className="btn btn-secondary btn-icon" onClick={zoomOut} title="Zoom Out">-</button>
        <button className="btn btn-secondary btn-icon" onClick={resetZoom} title="Reset">⟲</button>
      </div>

      <div
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: isDragging || isTouching ? "none" : "transform 0.15s ease-out",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          ref={svgRef}
          width="750"
          height="950"
          viewBox="50 30 700 900"
          style={{ minWidth: "700px", minHeight: "900px" }}
        >
          {/* Background rect to capture clicks */}
          <rect x="50" y="30" width="700" height="900" fill="transparent" />

          {/* Draw lines */}
          {linePaths.map((line, idx) => (
            <path
              key={idx}
              d={line.path}
              stroke={line.color}
              strokeWidth="7"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.85"
              style={{ transition: 'all 0.3s' }}
            />
          ))}

          {/* Connection markers */}
          <g stroke="#94a3b8" strokeWidth="2" strokeDasharray="4,4" opacity="0.6">
            <line x1="107" y1="870" x2="107" y2="910" /> {/* Chinor - Qipchaq */}
            <line x1="500" y1="520" x2="500" y2="550" /> {/* Mingo'rik - Oybek */}
          </g>

          {/* Render Stations */}
          {Object.entries(stations).map(([key, station]) => {
            const isSelected = selectedStationKey === key;
            const lineColor = stations[key].line === "blue" ? "var(--line-blue)" :
                              stations[key].line === "green" ? "var(--line-green)" :
                              stations[key].line === "red" ? "var(--line-red)" : "var(--line-yellow)";

            return (
              <g key={key} data-station={key}>
                {/* Outer shadow for selected station */}
                {isSelected && (
                  <circle
                    cx={station.x}
                    cy={station.y}
                    r="15"
                    fill="none"
                    stroke="var(--accent-color)"
                    strokeWidth="2.5"
                    strokeDasharray="3,3"
                    style={{
                      transformOrigin: `${station.x}px ${station.y}px`,
                      animation: "mapPulse 1.8s infinite linear"
                    }}
                  />
                )}

                {/* Base circle */}
                <circle
                  cx={station.x}
                  cy={station.y}
                  r={station.transfer ? "10" : "6.5"}
                  fill="white"
                  stroke={lineColor}
                  strokeWidth="3.5"
                  className="station-circle"
                  onClick={() => handleStationClick(key, station)}
                  style={{
                    filter: isSelected ? "drop-shadow(0 0 6px var(--accent-color))" : "none"
                  }}
                />

                {/* Transfer inner dot */}
                {station.transfer && (
                  <circle
                    cx={station.x}
                    cy={station.y}
                    r="4"
                    fill={lineColor}
                    style={{ pointerEvents: "none" }}
                  />
                )}

                {/* Labels - positioned nicely using overrides */}
                <text
                  x={
                    station.dx !== undefined
                      ? station.x + station.dx
                      : station.line === "yellow" && station.y > 900
                        ? station.x
                        : station.x + (station.x > 450 ? -12 : 12)
                  }
                  y={
                    station.dy !== undefined
                      ? station.y + station.dy
                      : station.line === "yellow" && station.y > 900
                        ? station.y + (["qoyliq", "qiyot", "tolariq", "quruvchilar"].includes(key) ? -12 : 20)
                        : station.y + 4
                  }
                  textAnchor={
                    station.textAnchor !== undefined
                      ? station.textAnchor
                      : station.line === "yellow" && station.y > 900
                        ? "middle"
                        : station.x > 450 ? "end" : "start"
                  }
                  className="station-text"
                  style={{
                    fill: isSelected ? "var(--accent-color)" : "var(--text-primary)",
                    fontWeight: "700"
                  }}
                  onClick={() => handleStationClick(key, station)}
                >
                  {station.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
