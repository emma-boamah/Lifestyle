import { useState } from 'react';
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Type, Image as ImageIcon, Square } from 'lucide-react';

export default function PropertiesPanel() {
    const [activeTab, setActiveTab] = useState('properties');
    const [opacity, setOpacity] = useState(100);

    return (
        <div className="properties-panel">
            <div className="panel-tabs">
                <button
                    className={`panel-tab ${activeTab === 'properties' ? 'active' : ''}`}
                    onClick={() => setActiveTab('properties')}
                >
                    Properties
                </button>
                <button
                    className={`panel-tab ${activeTab === 'layers' ? 'active' : ''}`}
                    onClick={() => setActiveTab('layers')}
                >
                    Layers
                </button>
                <button
                    className={`panel-tab ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                >
                    History
                </button>
            </div>

            {activeTab === 'properties' && (
                <>
                    <div className="panel-section">
                        <div className="panel-section-title">Text Styling</div>

                        <div className="control-group">
                            <label className="control-label">Font</label>
                            <select className="select-input">
                                <option>Inter</option>
                                <option>Arial</option>
                                <option>Helvetica</option>
                                <option>Times New Roman</option>
                            </select>
                        </div>

                        <div className="control-group">
                            <label className="control-label">Size</label>
                            <div className="control-row">
                                <select className="select-input">
                                    <option>Bold</option>
                                    <option>Regular</option>
                                    <option>Light</option>
                                </select>
                                <button className="icon-btn">
                                    <Bold size={16} />
                                </button>
                                <button className="icon-btn">
                                    <Italic size={16} />
                                </button>
                            </div>
                        </div>

                        <div className="control-group">
                            <div className="control-row">
                                <button className="icon-btn">
                                    <AlignLeft size={16} />
                                </button>
                                <button className="icon-btn">
                                    <AlignCenter size={16} />
                                </button>
                                <button className="icon-btn">
                                    <AlignRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="panel-section">
                        <div className="panel-section-title">Color & Opacity</div>

                        <div className="color-opacity-control">
                            <div
                                className="color-picker"
                                style={{ backgroundColor: '#000000' }}
                                title="Pick color"
                            ></div>

                            <div className="opacity-control">
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                    <span className="control-label">Opacity</span>
                                    <span className="opacity-value">{opacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={opacity}
                                    onChange={(e) => setOpacity(e.target.value)}
                                    className="slider"
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="panel-section">
                        <div className="panel-section-title">Arrange</div>

                        <div className="arrange-buttons">
                            <button className="arrange-btn">
                                <Square size={14} />
                                Back
                            </button>
                            <button className="arrange-btn">
                                <Square size={14} />
                                Front
                            </button>
                        </div>
                    </div>
                </>
            )}

            {activeTab === 'layers' && (
                <div className="panel-section">
                    <div className="panel-section-title">Selected Object Layers</div>

                    <div className="layer-item active">
                        <Type className="layer-icon" size={16} />
                        <span className="layer-name">"Modern Architecture..."</span>
                    </div>

                    <div className="layer-item">
                        <Square className="layer-icon" size={16} />
                        <span className="layer-name">Rectangle: Marking</span>
                    </div>

                    <div className="layer-item">
                        <ImageIcon className="layer-icon" size={16} />
                        <span className="layer-name">Aerial_Bridge_BG</span>
                    </div>
                </div>
            )}

            {activeTab === 'history' && (
                <div className="panel-section">
                    <div className="panel-section-title">History</div>
                    <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                        No actions yet
                    </div>
                </div>
            )}
        </div>
    );
}
