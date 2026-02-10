import { useState } from 'react';
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight, Type, Image as ImageIcon, Square } from 'lucide-react';

export default function PropertiesPanel({ activeObject, onUpdateObject }) {
    const [activeTab, setActiveTab] = useState('properties');

    // Helper to get property value safely
    const getProp = (prop, defaultValue) => activeObject ? (activeObject[prop] || defaultValue) : defaultValue;

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

                        {!activeObject ? (
                            <div style={{ padding: '1rem', color: '#666', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                Select an object to edit its properties.
                            </div>
                        ) : (
                            <>
                                <div className="control-group">
                                    <label className="control-label">Font</label>
                                    <select
                                        className="select-input"
                                        value={getProp('fontFamily', 'Arial')}
                                        onChange={(e) => onUpdateObject({ fontFamily: e.target.value })}
                                    >
                                        <option value="Inter">Inter</option>
                                        <option value="Arial">Arial</option>
                                        <option value="Helvetica">Helvetica</option>
                                        <option value="Times New Roman">Times New Roman</option>
                                        <option value="Courier New">Courier New</option>
                                    </select>
                                </div>

                                <div className="control-group">
                                    <label className="control-label">Size & Style</label>
                                    <div className="control-row">
                                        <input
                                            type="number"
                                            className="select-input"
                                            value={Math.round(getProp('fontSize', 20))}
                                            onChange={(e) => onUpdateObject({ fontSize: parseInt(e.target.value) })}
                                            style={{ width: '60px' }}
                                        />
                                        <button
                                            className={`icon-btn ${getProp('fontWeight') === 'bold' ? 'active' : ''}`}
                                            onClick={() => onUpdateObject({ fontWeight: getProp('fontWeight') === 'bold' ? 'normal' : 'bold' })}
                                            title="Bold"
                                        >
                                            <Bold size={16} />
                                        </button>
                                        <button
                                            className={`icon-btn ${getProp('fontStyle') === 'italic' ? 'active' : ''}`}
                                            onClick={() => onUpdateObject({ fontStyle: getProp('fontStyle') === 'italic' ? 'normal' : 'italic' })}
                                            title="Italic"
                                        >
                                            <Italic size={16} />
                                        </button>
                                    </div>
                                </div>

                                <div className="control-group">
                                    <div className="control-row">
                                        <button
                                            className={`icon-btn ${getProp('textAlign') === 'left' ? 'active' : ''}`}
                                            onClick={() => onUpdateObject({ textAlign: 'left' })}
                                            title="Align Left"
                                        >
                                            <AlignLeft size={16} />
                                        </button>
                                        <button
                                            className={`icon-btn ${getProp('textAlign') === 'center' ? 'active' : ''}`}
                                            onClick={() => onUpdateObject({ textAlign: 'center' })}
                                            title="Align Center"
                                        >
                                            <AlignCenter size={16} />
                                        </button>
                                        <button
                                            className={`icon-btn ${getProp('textAlign') === 'right' ? 'active' : ''}`}
                                            onClick={() => onUpdateObject({ textAlign: 'right' })}
                                            title="Align Right"
                                        >
                                            <AlignRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    <div className="panel-section">
                        <div className="panel-section-title">Color & Opacity</div>

                        <div className="color-opacity-control">
                            <div className="opacity-control" style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                    <span className="control-label">Opacity</span>
                                    <span className="opacity-value">{Math.round(getProp('opacity', 1) * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={Math.round(getProp('opacity', 1) * 100)}
                                    onChange={(e) => onUpdateObject({ opacity: parseInt(e.target.value) / 100 })}
                                    className="slider"
                                    disabled={!activeObject}
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="panel-section">
                        <div className="panel-section-title">Arrange</div>

                        <div className="arrange-buttons">
                            <button
                                className="arrange-btn"
                                disabled={!activeObject}
                                onClick={() => {
                                    // Should be handled in parent or via passing canvas reference, 
                                    // but for now we can't easily access canvas methods like sendBackwards from here 
                                    // without more prop drilling. 
                                    // Placeholder for future implementation.
                                    alert('Layer arrangement coming soon!');
                                }}
                            >
                                <Square size={14} />
                                Back
                            </button>
                            <button
                                className="arrange-btn"
                                disabled={!activeObject}
                                onClick={() => alert('Layer arrangement coming soon!')}
                            >
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

                    {activeObject ? (
                        <div className="layer-item active">
                            <Type className="layer-icon" size={16} />
                            <span className="layer-name">
                                {activeObject.text ?
                                    (activeObject.text.length > 20 ? activeObject.text.substring(0, 20) + '...' : activeObject.text)
                                    : activeObject.type}
                            </span>
                        </div>
                    ) : (
                        <div style={{ padding: '1rem', color: '#666', fontStyle: 'italic', fontSize: '0.9rem' }}>
                            No object selected.
                        </div>
                    )}
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
