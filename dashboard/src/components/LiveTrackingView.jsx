import React from 'react';
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { fmtPrice } from '../format';

const createGlowIcon = (colorClass) => {
  return L.divIcon({
    className: `leaflet-glow-container`,
    html: `<div class="custom-glow-icon ${colorClass}"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

const LiveTrackingView = ({ listings }) => {
  return (
    <div className="view-container full-map-view">
      <div className="view-header absolute-header">
        <h2>LIVE TRACKING</h2>
        <p>Real-time global geospatial overview</p>
      </div>
      
      <div className="full-map-container">
        <MapContainer 
          center={[39.8283, -98.5795]} 
          zoom={3} 
          minZoom={2}
          maxBounds={[[-90, -180], [90, 180]]}
          maxBoundsViscosity={1.0}
          style={{ height: '100%', width: '100%', background: '#050711' }} 
          zoomControl={true} 
          attributionControl={false}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            className="cyber-tiles"
            noWrap={true}
          />
          
          {listings.map((item) => {
            if (item.lat && item.lng && item.lat !== 0) {
              const colorName = item.colorClass.split('-')[0];
              return (
                <Marker key={item.listing_id} position={[item.lat, item.lng]} icon={createGlowIcon(`glow-${colorName}`)}>
                  <Tooltip direction="top" offset={[0, -15]} opacity={1} permanent={false} className="heat-tooltip hover-only">
                    <strong>{item.make} {item.model}</strong><br/>
                    {item.location}<br/>
                    {fmtPrice(item.price, item.currency)}<br/>
                    Status: {item.status}
                  </Tooltip>
                </Marker>
              )
            }
            return null;
          })}
        </MapContainer>
      </div>
    </div>
  );
};

export default LiveTrackingView;
