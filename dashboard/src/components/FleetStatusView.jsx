import React from 'react';
import { fmtPrice, fmtHours, fmtYear } from '../format';
import { statusTheme } from '../statusColors';
import EmptyState from '../ui/EmptyState';

const FleetStatusView = ({ listings }) => {
  return (
    <div className="view-container">
      <div className="view-header">
        <h2>FLEET STATUS</h2>
        <p>Complete directory of all tracked heavy machinery.</p>
      </div>
      
      <div className="table-container">
        <table className="fleet-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Make & Model</th>
              <th>Year</th>
              <th>Hours</th>
              <th>Price</th>
              <th>Location</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {listings.map(item => (
              <tr key={item.listing_id}>
                <td className="mono">{item.listing_id.substring(0, 8)}...</td>
                <td><strong>{item.make}</strong> {item.model}</td>
                <td>{fmtYear(item.year)}</td>
                <td>{fmtHours(item.hours)}</td>
                <td className="price-tag">{fmtPrice(item.price, item.currency)}</td>
                <td>{item.location}</td>
                <td>
                  <span className={`source-badge source-${item.source.toLowerCase()}`}>
                    {item.source}
                  </span>
                </td>
                <td>
                  <span className={`status-badge ${statusTheme(item.status)}`}>
                    {item.status}
                  </span>
                </td>
              </tr>
            ))}
            {listings.length === 0 && (
              <tr>
                <td colSpan="8"><EmptyState icon="excavator" title="No machinery yet"
                  hint="Machines appear here as the harvester finds them." /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FleetStatusView;
