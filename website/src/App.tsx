import { Navigate, Route, Routes } from 'react-router-dom';
import HomePage from './pages/Home';
import TermsPage from './pages/Terms';
import PrivacyPage from './pages/Privacy';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
