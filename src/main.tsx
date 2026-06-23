import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { Navigate, NavLink, Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import './styles.css';

const ModelViewer = lazy(() => import('./components/ModelViewer'));
const OrthophotoViewer = lazy(() => import('./components/OrthophotoViewer'));
const PointCloudViewer = lazy(() => import('./components/PointCloudViewer'));

function App() {
  return (
    <Router>
      <div className="app">
        <header className="topbar">
          <NavLink to="/orthophoto">Orthophoto</NavLink>
          <NavLink to="/model">Model</NavLink>
          <NavLink to="/pointcloud">Point Cloud</NavLink>
        </header>

        <Suspense fallback={<div className="loading-card route-loading">Loading view...</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/orthophoto" replace />} />
            <Route path="/model" element={<ModelViewer />} />
            <Route path="/pointcloud" element={<PointCloudViewer />} />
            <Route path="/orthophoto" element={<OrthophotoViewer />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
