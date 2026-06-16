import React, { useState, useEffect } from "react";
import {
  PencilLine, ArrowLeftRight, CirclePlus, CalendarDays, UserRound, Info,
  Cctv, Tv, HardDrive, Network, Laptop, ScanSearch, Layers, Search,
  History, TrainFront, MapPin
} from "lucide-react";
import { API_BASE_URL } from "../config";
import CameraSchema from "./CameraSchema";

const getEndpointTab = (tab) => {
  if (tab === "metal_detector") return "metal-detectors";
  return `${tab}s`;
};

export default function StationDetail({ stationId, apiStations, token, t, refreshStation, showNotification }) {
  const [station, setStation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("camera"); // camera, monitor, nvr, switch, computer, metal_detector, schema
  const [searchQuery, setSearchQuery] = useState("");

  // Modal states
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // Selected device for modal operations
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Form states
  const [comment, setComment] = useState("");
  const [editFields, setEditFields] = useState({});
  const [moveStationId, setMoveStationId] = useState("");
  const [moveQuantity, setMoveQuantity] = useState(1);
  const [adjustAction, setAdjustAction] = useState("transfer"); // transfer, decrease, increase
  const [addFields, setAddFields] = useState({});

  useEffect(() => {
    if (stationId) {
      fetchStationDetails();
    }
  }, [stationId]);

  const fetchStationDetails = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/stations/${stationId}/`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error("Could not fetch station details");
      const data = await response.json();
      setStation(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getDevicesForActiveTab = () => {
    if (!station) return [];
    let list = [];
    switch (activeTab) {
      case "camera": list = station.cameras || []; break;
      case "monitor": list = station.monitors || []; break;
      case "nvr": list = station.nvrs || []; break;
      case "switch": list = station.switches || []; break;
      case "computer": list = station.computers || []; break;
      case "metal_detector": list = station.metal_detectors || []; break;
      default: list = [];
    }

    if (searchQuery.trim() === "") return list;
    return list.filter(item => {
      const brandVal = item.brand || item.switch_type || "";
      return brandVal.toLowerCase().includes(searchQuery.toLowerCase());
    });
  };

  // Open edit modal
  const handleEditClick = (device) => {
    setSelectedDevice(device);
    setComment("");
    setEditFields({ ...device });
    setEditModalOpen(true);
  };

  // Submit edit
  const handleEditSubmit = async (e) => {
    e.preventDefault();

    const { quantity, ...fieldsToSave } = editFields;

    const endpoint = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/${selectedDevice.id}/`;
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ...fieldsToSave,
          comment: comment
        })
      });

      if (!response.ok) throw new Error("Failed to save changes");
      
      showNotification("success", t.title, t.successSaved);
      setEditModalOpen(false);
      fetchStationDetails();
      if (refreshStation) refreshStation();
    } catch (err) {
      showNotification("error", t.title, t.errorSaving);
    }
  };

  // Open move / adjustment modal
  const handleMoveClick = (device) => {
    setSelectedDevice(device);
    setComment("");
    setMoveStationId("");
    setMoveQuantity(1);
    setAdjustAction("transfer");
    setMoveModalOpen(true);
  };

  // Submit adjustment (transfer / decrease / increase)
  const handleMoveSubmit = async (e) => {
    e.preventDefault();

    const parsedQty = parseInt(moveQuantity) || 0;
    const currentQty = selectedDevice.quantity || 1;
    const isRu = t.title && t.title.includes("Ташкентский");
    const isEn = t.title && t.title.includes("Tashkent Metro");
    const isUz = !isRu && !isEn;

    if (adjustAction === "transfer") {
      if (!moveStationId) {
        showNotification("warning", t.title, t.targetStation);
        return;
      }
      if (parsedQty <= 0 || parsedQty > currentQty) {
        showNotification("warning", t.title, `${t.adjustAmount}: 1 - ${currentQty}`);
        return;
      }

      const destStationName = apiStations.find(s => s.id === parseInt(moveStationId))?.name || "";
      const sourceStationName = station?.name || "";

      // If full transfer (all items moved)
      if (parsedQty === currentQty) {
        const endpoint = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/${selectedDevice.id}/`;
        try {
          const response = await fetch(endpoint, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              station: parseInt(moveStationId),
              quantity: currentQty,
              comment: comment
            })
          });
          if (!response.ok) throw new Error("Failed to transfer");
          showNotification("success", t.title, t.successAdjusted);
          setMoveModalOpen(false);
          fetchStationDetails();
          if (refreshStation) refreshStation();
        } catch (err) {
          showNotification("error", t.title, t.errorSaving);
        }
      } else {
        // Partial transfer: decrease source quantity & create new at destination
        const endpointSource = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/${selectedDevice.id}/`;
        try {
          const responseSource = await fetch(endpointSource, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              quantity: currentQty - parsedQty,
              comment: `${parsedQty} dona ${t.actionTransfer.toLowerCase()} qilindi. ${comment}`
            })
          });
          if (!responseSource.ok) throw new Error("Failed to adjust source");

          const endpointDest = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/`;
          const newDeviceFields = { ...selectedDevice };
          delete newDeviceFields.id;
          delete newDeviceFields.created_at;
          delete newDeviceFields.updated_at;
          newDeviceFields.station = parseInt(moveStationId);
          newDeviceFields.quantity = parsedQty;

          const movedFromComment = isUz ? `${sourceStationName} ${t.movedFrom}` : `${t.movedFrom} ${sourceStationName}`;
          newDeviceFields.comment = `${movedFromComment}. ${comment}`;

          const responseDest = await fetch(endpointDest, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify(newDeviceFields)
          });
          if (!responseDest.ok) throw new Error("Failed to create at destination");

          showNotification("success", t.title, t.successAdjusted);
          setMoveModalOpen(false);
          fetchStationDetails();
          if (refreshStation) refreshStation();
        } catch (err) {
          showNotification("error", t.title, t.errorSaving);
        }
      }
    } else if (adjustAction === "decrease") {
      if (parsedQty <= 0 || parsedQty > currentQty) {
        showNotification("warning", t.title, `${t.adjustAmount}: 1 - ${currentQty}`);
        return;
      }
      const endpoint = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/${selectedDevice.id}/`;
      try {
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            quantity: currentQty - parsedQty,
            comment: `${t.actionDecrease}: -${parsedQty}. ${comment}`
          })
        });
        if (!response.ok) throw new Error("Failed to decrease quantity");
        showNotification("success", t.title, t.successAdjusted);
        setMoveModalOpen(false);
        fetchStationDetails();
        if (refreshStation) refreshStation();
      } catch (err) {
        showNotification("error", t.title, t.errorSaving);
      }
    } else if (adjustAction === "increase") {
      if (parsedQty <= 0) {
        showNotification("warning", t.title, `${t.adjustAmount} > 0`);
        return;
      }
      const endpoint = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/${selectedDevice.id}/`;
      try {
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            quantity: currentQty + parsedQty,
            comment: `${t.actionIncrease}: +${parsedQty}. ${comment}`
          })
        });
        if (!response.ok) throw new Error("Failed to increase quantity");
        showNotification("success", t.title, t.successAdjusted);
        setMoveModalOpen(false);
        fetchStationDetails();
        if (refreshStation) refreshStation();
      } catch (err) {
        showNotification("error", t.title, t.errorSaving);
      }
    }
  };

  // Fetch and show history logs
  const handleHistoryClick = async (device) => {
    setSelectedDevice(device);
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/device-histories/?station=${stationId}&device_type=${activeTab}`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error("Failed to fetch logs");
      const data = await response.json();
      
      const results = Array.isArray(data) ? data : data.results || [];
      const filtered = results.filter(log => log.device_id === device.id);
      setHistoryLogs(filtered);
    } catch (err) {
      console.error(err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Add equipment modal trigger
  const handleAddClick = () => {
    setComment("");
    const initialFields = { station: stationId, quantity: 1 };
    if (activeTab === "camera") {
      initialFields.camera_type = "";
      initialFields.brand = "";
    } else if (activeTab === "monitor") {
      initialFields.size = "22";
      initialFields.brand = "";
    } else if (activeTab === "nvr") {
      initialFields.ports_count = 16;
      initialFields.model_name = "";
      initialFields.brand = "";
    } else if (activeTab === "switch") {
      initialFields.switch_type = "PoE";
      initialFields.ports_count = 8;
      initialFields.features = "";
    } else {
      initialFields.brand = "";
    }
    setAddFields(initialFields);
    setAddModalOpen(true);
  };

  // Submit add
  const handleAddSubmit = async (e) => {
    e.preventDefault();

    const finalQty = parseInt(addFields.quantity) || 1;
    const finalFields = { ...addFields, quantity: finalQty };

    const endpoint = `${API_BASE_URL}/api/${getEndpointTab(activeTab)}/`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          ...finalFields,
          comment: comment
        })
      });

      if (!response.ok) throw new Error("Failed to add device");

      showNotification("success", t.title, t.successAdded);
      setAddModalOpen(false);
      fetchStationDetails();
      if (refreshStation) refreshStation();
    } catch (err) {
      showNotification("error", t.title, t.errorSaving);
    }
  };

  const getAddButtonLabel = () => {
    switch (activeTab) {
      case "camera": return t.addCamera;
      case "monitor": return t.addMonitor;
      case "nvr": return t.addNvr;
      case "switch": return t.addSwitch;
      case "computer": return t.addComputer;
      case "metal_detector": return t.addMetalDetector;
      default: return t.addDevice;
    }
  };

  if (!stationId) {
    return (
      <div className="card text-center" style={{ padding: "4rem 2rem", background: "transparent", borderStyle: "dashed" }}>
        <div className="empty-icon-wrap" style={{ margin: "0 auto 0.75rem" }}>
          <TrainFront size={28} strokeWidth={1.75} />
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "1.1rem" }}>
          {t.selectStationFromMap}
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "4rem" }}>
        <div className="btn btn-secondary" style={{ pointerEvents: "none" }}>{t.loading}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderColor: "var(--danger-color)", color: "var(--danger-color)" }}>
        <h3>Error loading station</h3>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={fetchStationDetails} style={{ marginTop: "1rem" }}>{t.retry || "Retry"}</button>
      </div>
    );
  }

  const devices = getDevicesForActiveTab();
  const stationLineColor = station.line_name?.toLowerCase().includes("chilonzor") || station.line_name?.toLowerCase().includes("blue") ? "var(--line-blue)" :
                           station.line_name?.toLowerCase().includes("yunusobod") || station.line_name?.toLowerCase().includes("green") ? "var(--line-green)" :
                           station.line_name?.toLowerCase().includes("o'zbekiston") || station.line_name?.toLowerCase().includes("red") ? "var(--line-red)" : "var(--line-yellow)";

  return (
    <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Station Header — line info only (name is in page header) */}
      <div className="card" style={{ borderLeft: `6px solid ${stationLineColor}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
          <span style={{ fontSize: "0.75rem", fontWeight: "700", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
            <MapPin size={13} strokeWidth={1.75} style={{ color: stationLineColor }} />
            {t.line}: {station.line_name || "Metropoliten"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-container">
        <button className={`tab-btn ${activeTab === "camera" ? "active" : ""}`} onClick={() => setActiveTab("camera")}>
          <span className="tab-icon"><Cctv size={13} strokeWidth={1.75} /></span>
          {t.cameras} ({station.cameras?.length || 0})
        </button>
        <button className={`tab-btn ${activeTab === "monitor" ? "active" : ""}`} onClick={() => setActiveTab("monitor")}>
          <span className="tab-icon"><Tv size={13} strokeWidth={1.75} /></span>
          {t.monitors} ({station.monitors?.length || 0})
        </button>
        <button className={`tab-btn ${activeTab === "nvr" ? "active" : ""}`} onClick={() => setActiveTab("nvr")}>
          <span className="tab-icon"><HardDrive size={13} strokeWidth={1.75} /></span>
          {t.nvrs} ({station.nvrs?.length || 0})
        </button>
        <button className={`tab-btn ${activeTab === "switch" ? "active" : ""}`} onClick={() => setActiveTab("switch")}>
          <span className="tab-icon"><Network size={13} strokeWidth={1.75} /></span>
          {t.switches} ({station.switches?.length || 0})
        </button>
        <button className={`tab-btn ${activeTab === "computer" ? "active" : ""}`} onClick={() => setActiveTab("computer")}>
          <span className="tab-icon"><Laptop size={13} strokeWidth={1.75} /></span>
          {t.computers} ({station.computers?.length || 0})
        </button>
        <button className={`tab-btn ${activeTab === "metal_detector" ? "active" : ""}`} onClick={() => setActiveTab("metal_detector")}>
          <span className="tab-icon"><ScanSearch size={13} strokeWidth={1.75} /></span>
          {t.metalDetectors} ({station.metal_detectors?.length || 0})
        </button>
        <button
          className={`tab-btn ${activeTab === "schema" ? "active" : ""}`}
          onClick={() => setActiveTab("schema")}
        >
          <span className="tab-icon"><Layers size={13} strokeWidth={1.75} /></span>
          {t.schemaTab}
        </button>
      </div>

      {/* ─── SXEMA TAB: CameraSchema komponenti ─── */}
      {activeTab === "schema" && (
        <CameraSchema
          station={station}
          token={token}
          t={t}
          showNotification={showNotification}
          onRefresh={() => {
            fetchStationDetails();
            if (refreshStation) refreshStation();
          }}
        />
      )}

      {/* ─── QURILMA TABLARI: search + table + add button ─── */}
      {activeTab !== "schema" && (
        <>
          {/* Search Bar */}
          <div className="search-bar-wrap">
            <Search size={16} strokeWidth={1.75} />
            <input
              type="text"
              className="form-input"
              placeholder={t.search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Table Workspace */}
          {devices.length === 0 ? (
            <div className="card text-center" style={{ padding: "3rem", background: "var(--bg-secondary)", opacity: 0.8 }}>
              <p style={{ color: "var(--text-secondary)" }}>{t.noData}</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    {activeTab === "switch" ? (
                      <>
                        <th>{t.type}</th>
                        <th>{t.ports}</th>
                        <th>{t.features}</th>
                      </>
                    ) : activeTab === "nvr" ? (
                      <>
                        <th>{t.brand}</th>
                        <th>{t.type} (Model)</th>
                        <th>{t.ports}</th>
                      </>
                    ) : activeTab === "camera" ? (
                      <>
                        <th>{t.brand}</th>
                        <th>{t.type}</th>
                      </>
                    ) : activeTab === "monitor" ? (
                      <>
                        <th>{t.brand}</th>
                        <th>{t.size}</th>
                      </>
                    ) : (
                      <th>{t.brand}</th>
                    )}
                    <th>{t.quantity}</th>
                    <th style={{ textAlign: "right" }}>{t.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      {activeTab === "switch" ? (
                        <>
                          <td style={{ fontWeight: 600 }}>{device.switch_type}</td>
                          <td>{device.ports_count}</td>
                          <td style={{ color: "var(--text-secondary)" }}>{device.features || "-"}</td>
                        </>
                      ) : activeTab === "nvr" ? (
                        <>
                          <td style={{ fontWeight: 600 }}>{device.brand}</td>
                          <td>{device.model_name}</td>
                          <td>{device.ports_count}</td>
                        </>
                      ) : activeTab === "camera" ? (
                        <>
                          <td style={{ fontWeight: 600 }}>{device.brand}</td>
                          <td><span className="badge badge-moved">{device.camera_type}</span></td>
                        </>
                      ) : activeTab === "monitor" ? (
                        <>
                          <td style={{ fontWeight: 600 }}>{device.brand}</td>
                          <td>{device.size}″</td>
                        </>
                      ) : (
                        <td style={{ fontWeight: 600 }}>{device.brand || "Standard"}</td>
                      )}
                      <td>
                        <span style={{ fontWeight: "700", color: "var(--accent-color)" }}>{device.quantity}</span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                          <button className="btn btn-secondary btn-icon btn-action-icon" onClick={() => handleHistoryClick(device)} title={t.history}>
                            <History size={15} strokeWidth={1.75} />
                          </button>
                          <button className="btn btn-secondary btn-icon btn-action-icon" onClick={() => handleEditClick(device)} title={t.edit}>
                            <PencilLine size={15} strokeWidth={1.75} />
                          </button>
                          <button className="btn btn-secondary btn-icon btn-action-icon" onClick={() => handleMoveClick(device)} title={t.move}>
                            <ArrowLeftRight size={15} strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Dynamic Add button at the bottom */}
          <div className="add-device-footer">
            <button className="btn-add-device" onClick={handleAddClick}>
              <CirclePlus size={18} strokeWidth={1.75} /> {getAddButtonLabel()}
            </button>
          </div>
        </>
      )}

      {/* ================= EDIT MODAL ================= */}
      {editModalOpen && selectedDevice && (
        <div className="modal-overlay">
          <form className="modal-content animate-scale-in" onSubmit={handleEditSubmit}>
            <div className="modal-header">
              <h3>{t.editDevice}</h3>
              <button type="button" className="btn btn-secondary btn-icon" onClick={() => setEditModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {activeTab === "switch" ? (
                <>
                  <div className="form-group">
                    <label>{t.type}</label>
                    <input type="text" className="form-input" value={editFields.switch_type || ""} onChange={(e) => setEditFields({ ...editFields, switch_type: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>{t.ports}</label>
                    <input type="number" className="form-input" value={editFields.ports_count || 8} onChange={(e) => setEditFields({ ...editFields, ports_count: parseInt(e.target.value) })} required />
                  </div>
                  <div className="form-group">
                    <label>{t.features}</label>
                    <textarea className="form-input" style={{ minHeight: "60px" }} value={editFields.features || ""} onChange={(e) => setEditFields({ ...editFields, features: e.target.value })} />
                  </div>
                </>
              ) : activeTab === "nvr" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" value={editFields.brand || ""} onChange={(e) => setEditFields({ ...editFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Model</label>
                    <input type="text" className="form-input" value={editFields.model_name || ""} onChange={(e) => setEditFields({ ...editFields, model_name: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>{t.ports}</label>
                    <input type="number" className="form-input" value={editFields.ports_count || 16} onChange={(e) => setEditFields({ ...editFields, ports_count: parseInt(e.target.value) })} required />
                  </div>
                </>
              ) : activeTab === "camera" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" value={editFields.brand || ""} onChange={(e) => setEditFields({ ...editFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>{t.type}</label>
                    <input type="text" className="form-input" value={editFields.camera_type || ""} onChange={(e) => setEditFields({ ...editFields, camera_type: e.target.value })} required />
                  </div>
                </>
              ) : activeTab === "monitor" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" value={editFields.brand || ""} onChange={(e) => setEditFields({ ...editFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>{t.size}</label>
                    <input type="text" className="form-input" value={editFields.size || ""} onChange={(e) => setEditFields({ ...editFields, size: e.target.value })} required />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" value={editFields.brand || ""} onChange={(e) => setEditFields({ ...editFields, brand: e.target.value })} />
                  </div>
                </>
              )}

              {/* Optional Comment Field */}
              <div className="form-group" style={{ marginTop: "1rem", borderTop: "1px dashed var(--border-color)", paddingTop: "1rem" }}>
                <label style={{ color: "var(--accent-color)" }}>{t.comment}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t.commentPlaceholder}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setEditModalOpen(false)}>{t.cancel}</button>
              <button type="submit" className="btn btn-primary">{t.save}</button>
            </div>
          </form>
        </div>
      )}

      {/* ================= ADJUSTMENT MODAL (TRANSFER/DECREASE/INCREASE) ================= */}
      {moveModalOpen && selectedDevice && (
        <div className="modal-overlay">
          <form className="modal-content animate-scale-in" onSubmit={handleMoveSubmit}>
            <div className="modal-header">
              <h3>{t.adjustTitle}</h3>
              <button type="button" className="btn btn-secondary btn-icon" onClick={() => setMoveModalOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div style={{ background: "var(--bg-tertiary)", padding: "0.85rem 1rem", borderRadius: "10px", display: "flex", gap: "0.5rem", border: "1px solid var(--border-color)" }}>
                <Info size={18} strokeWidth={1.75} style={{ color: "var(--accent-color)", flexShrink: 0, marginTop: "2px" }} />
                <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: "1.4" }}>
                  {t.deviceInfo}: <strong>{selectedDevice.brand || selectedDevice.switch_type || "Standard"}</strong> (Jami: {selectedDevice.quantity})
                </p>
              </div>

              {/* Segment Action Selector */}
              <div className="segment-control">
                <button
                  type="button"
                  className={`segment-btn ${adjustAction === "transfer" ? "active blue" : ""}`}
                  onClick={() => {
                    setAdjustAction("transfer");
                    setMoveQuantity(1);
                  }}
                >
                  {t.actionTransfer}
                </button>
                <button
                  type="button"
                  className={`segment-btn ${adjustAction === "decrease" ? "active danger" : ""}`}
                  onClick={() => {
                    setAdjustAction("decrease");
                    setMoveQuantity(1);
                  }}
                >
                  {t.actionDecrease}
                </button>
                <button
                  type="button"
                  className={`segment-btn ${adjustAction === "increase" ? "active green" : ""}`}
                  onClick={() => {
                    setAdjustAction("increase");
                    setMoveQuantity(1);
                  }}
                >
                  {t.actionIncrease}
                </button>
              </div>

              {/* Destination Station selection (Only for transfer) */}
              {adjustAction === "transfer" && (
                <div className="form-group">
                  <label>{t.targetStation}</label>
                  <select className="select-input" style={{ width: "100%" }} value={moveStationId} onChange={(e) => setMoveStationId(e.target.value)} required>
                    <option value="">-- {t.targetStation} --</option>
                    {apiStations.filter(s => s.id !== parseInt(stationId)).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.line_name})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Quantity */}
              <div className="form-group">
                <label>{t.adjustAmount}</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max={adjustAction !== "increase" ? selectedDevice.quantity : undefined}
                  value={moveQuantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    setMoveQuantity(isNaN(val) ? "" : val);
                  }}
                  required
                />
              </div>

              {/* Optional Comment */}
              <div className="form-group">
                <label style={{ color: "var(--accent-color)" }}>{t.comment}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t.commentPlaceholder}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setMoveModalOpen(false)}>{t.cancel}</button>
              <button type="submit" className="btn btn-primary">{t.apply}</button>
            </div>
          </form>
        </div>
      )}

      {/* ================= HISTORY TIMELINE MODAL ================= */}
      {historyModalOpen && selectedDevice && (
        <div className="modal-overlay">
          <div className="modal-content wide animate-scale-in">
            <div className="modal-header">
              <h3>{t.historyTitle}</h3>
              <button type="button" className="btn btn-secondary btn-icon" onClick={() => setHistoryModalOpen(false)}>×</button>
            </div>
            <div className="modal-body" style={{ minHeight: "250px" }}>
              <div style={{ marginBottom: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                {t.deviceInfo}: <strong>{selectedDevice.brand || selectedDevice.switch_type || "Standard"}</strong> | {t.selectedStation}: <strong>{station.name}</strong>
              </div>

              {historyLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "3rem" }}>{t.loading}</div>
              ) : historyLogs.length === 0 ? (
                <div className="text-center" style={{ padding: "3rem", color: "var(--text-muted)", fontSize: "0.9rem" }}>
                  {t.noHistory}
                </div>
              ) : (
                <div className="timeline">
                  {historyLogs.map((log) => {
                    const actionClass = log.action.includes("Qo'shildi") || log.action.includes("Added") || log.action.includes("increased") || log.action.includes("Ko'paytirildi") ? "added" :
                                        log.action.includes("O'chirildi") || log.action.includes("Deleted") || log.action.includes("decreased") || log.action.includes("Kamaytildi") ? "deleted" :
                                        log.action.includes("Tahrirlandi") || log.action.includes("Edited") ? "edited" : "moved";

                    const badgeClass = log.action.includes("Qo'shildi") || log.action.includes("Added") || log.action.includes("increased") || log.action.includes("Ko'paytirildi") ? "badge-added" :
                                       log.action.includes("O'chirildi") || log.action.includes("Deleted") || log.action.includes("decreased") || log.action.includes("Kamaytildi") ? "badge-deleted" :
                                       log.action.includes("Tahrirlandi") || log.action.includes("Edited") ? "badge-edited" : "badge-moved";

                    const formattedDate = new Date(log.created_at).toLocaleString();

                    return (
                      <div className="timeline-item" key={log.id}>
                        <div className={`timeline-dot ${actionClass}`}></div>
                        <div className="timeline-content">
                          <div className="timeline-header">
                            <span className="badge" style={{ padding: "0" }}>
                              <span className={`badge ${badgeClass}`}>{log.action}</span>
                            </span>
                            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                              <CalendarDays size={12} strokeWidth={1.75} /> {formattedDate}
                            </span>
                          </div>
                          
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem" }}>
                            <span style={{ fontWeight: 600 }}>{t.countChanged}: {log.quantity_change > 0 ? `+${log.quantity_change}` : log.quantity_change}</span>
                            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.2rem" }}>
                              <UserRound size={12} strokeWidth={1.75} /> {log.user_name || "System"}
                            </span>
                          </div>

                          {log.comment && (
                            <div className="timeline-comment">
                              {log.comment}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setHistoryModalOpen(false)}>{t.close}</button>
            </div>
          </div>
        </div>
      )}

      {/* ================= ADD MODAL ================= */}
      {addModalOpen && (
        <div className="modal-overlay">
          <form className="modal-content animate-scale-in" onSubmit={handleAddSubmit}>
            <div className="modal-header">
              <h3>{t.addDevice} ({t[activeTab + "s"] || activeTab})</h3>
              <button type="button" className="btn btn-secondary btn-icon" onClick={() => setAddModalOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {activeTab === "switch" ? (
                <>
                  <div className="form-group">
                    <label>{t.type}</label>
                    <input type="text" className="form-input" placeholder="PoE, L2 Managed, oddiy va h.k." value={addFields.switch_type || ""} onChange={(e) => setAddFields({ ...addFields, switch_type: e.target.value })} required />
                  </div>
                  <div className="form-input-grid">
                    <div className="form-group">
                      <label>{t.ports}</label>
                      <input type="number" className="form-input" value={addFields.ports_count || 8} onChange={(e) => setAddFields({ ...addFields, ports_count: parseInt(e.target.value) })} required />
                    </div>
                    <div className="form-group">
                      <label>{t.quantity}</label>
                      <input type="number" className="form-input" min="1" value={addFields.quantity !== undefined ? addFields.quantity : ""} onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setAddFields({ ...addFields, quantity: isNaN(val) ? "" : val });
                      }} required />
                    </div>
                  </div>
                  <div className="form-group">
                    <label>{t.features}</label>
                    <textarea className="form-input" placeholder="Xususiyatlari..." style={{ minHeight: "60px" }} value={addFields.features || ""} onChange={(e) => setAddFields({ ...addFields, features: e.target.value })} />
                  </div>
                </>
              ) : activeTab === "nvr" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" placeholder="Hikvision, Dahua va h.k." value={addFields.brand || ""} onChange={(e) => setAddFields({ ...addFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Model</label>
                    <input type="text" className="form-input" placeholder="DS-7616NI-Q2" value={addFields.model_name || ""} onChange={(e) => setAddFields({ ...addFields, model_name: e.target.value })} required />
                  </div>
                  <div className="form-input-grid">
                    <div className="form-group">
                      <label>{t.ports}</label>
                      <input type="number" className="form-input" value={addFields.ports_count || 16} onChange={(e) => setAddFields({ ...addFields, ports_count: parseInt(e.target.value) })} required />
                    </div>
                    <div className="form-group">
                      <label>{t.quantity}</label>
                      <input type="number" className="form-input" min="1" value={addFields.quantity !== undefined ? addFields.quantity : ""} onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setAddFields({ ...addFields, quantity: isNaN(val) ? "" : val });
                      }} required />
                    </div>
                  </div>
                </>
              ) : activeTab === "camera" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" placeholder="Hikvision, Dahua, Ezviz..." value={addFields.brand || ""} onChange={(e) => setAddFields({ ...addFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-input-grid">
                    <div className="form-group">
                      <label>{t.type}</label>
                      <input type="text" className="form-input" placeholder="IP, Analog, PTZ..." value={addFields.camera_type || ""} onChange={(e) => setAddFields({ ...addFields, camera_type: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label>{t.quantity}</label>
                      <input type="number" className="form-input" min="1" value={addFields.quantity !== undefined ? addFields.quantity : ""} onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setAddFields({ ...addFields, quantity: isNaN(val) ? "" : val });
                      }} required />
                    </div>
                  </div>
                </>
              ) : activeTab === "monitor" ? (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" placeholder="LG, Samsung, Philips..." value={addFields.brand || ""} onChange={(e) => setAddFields({ ...addFields, brand: e.target.value })} required />
                  </div>
                  <div className="form-input-grid">
                    <div className="form-group">
                      <label>{t.size}</label>
                      <input type="text" className="form-input" placeholder="24, 32 va h.k." value={addFields.size || "22"} onChange={(e) => setAddFields({ ...addFields, size: e.target.value })} required />
                    </div>
                    <div className="form-group">
                      <label>{t.quantity}</label>
                      <input type="number" className="form-input" min="1" value={addFields.quantity !== undefined ? addFields.quantity : ""} onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setAddFields({ ...addFields, quantity: isNaN(val) ? "" : val });
                      }} required />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label>{t.brand}</label>
                    <input type="text" className="form-input" placeholder="Brend nomi" value={addFields.brand || ""} onChange={(e) => setAddFields({ ...addFields, brand: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>{t.quantity}</label>
                    <input type="number" className="form-input" min="1" value={addFields.quantity !== undefined ? addFields.quantity : ""} onChange={(e) => {
                      const val = parseInt(e.target.value);
                      setAddFields({ ...addFields, quantity: isNaN(val) ? "" : val });
                    }} required />
                  </div>
                </>
              )}

              <div className="form-group" style={{ marginTop: "1rem", borderTop: "1px dashed var(--border-color)", paddingTop: "1rem" }}>
                <label style={{ color: "var(--accent-color)" }}>{t.comment}</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder={t.commentPlaceholder}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setAddModalOpen(false)}>{t.cancel}</button>
              <button type="submit" className="btn btn-primary">{t.save}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
