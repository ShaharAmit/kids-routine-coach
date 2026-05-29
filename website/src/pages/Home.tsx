import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSiteConfig, resolveWelcomeVideoUrl, SiteConfig } from '../services/siteConfig';
import { getCachedVideoSource } from '../services/videoCache';
import '../styles/home.css';

const FALLBACK: SiteConfig = {
  welcomeVideoUrl: 'avatars/default/welcome.mp4',
  appStoreUrl: 'https://apps.apple.com/',
  playStoreUrl: 'https://play.google.com/store',
};

export default function HomePage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [siteConfig, setSiteConfig] = useState<SiteConfig>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [videoError, setVideoError] = useState<string>('');

  useEffect(() => {
    let mounted = true;
    let releaseCachedVideo: (() => void) | undefined;

    async function loadConfig() {
      try {
        const config = await fetchSiteConfig();
        const resolvedVideoUrl = await resolveWelcomeVideoUrl(config.welcomeVideoUrl);
        const cachedVideo = await getCachedVideoSource(resolvedVideoUrl);
        if (mounted) {
          setSiteConfig(config);
          setVideoSrc(cachedVideo.src);
          setVideoError('');
        }
        releaseCachedVideo = cachedVideo.release;
      } catch (error) {
        console.warn('Failed to load site config from Firestore', error);
        if (mounted) {
          setVideoSrc('');
          setVideoError('Welcome video failed to load from config.');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadConfig();
    return () => {
      mounted = false;
      if (releaseCachedVideo) {
        releaseCachedVideo();
      }
    };
  }, []);

  return (
    <main className="home-shell">
      <header className="top-bar">
        <div className="brand-lockup" aria-label="KidoCoach brand">
          <span className="brand-mark" aria-hidden="true">
            KC
          </span>
          <span className="brand-name">KidoCoach</span>
        </div>

        <button
          className={`burger ${menuOpen ? 'open' : ''}`}
          type="button"
          aria-label="Open legal links"
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>

        <nav className={`menu-sheet ${menuOpen ? 'visible' : ''}`}>
          <Link to="/terms" onClick={() => setMenuOpen(false)}>
            Terms and Conditions
          </Link>
          <Link to="/privacy" onClick={() => setMenuOpen(false)}>
            Privacy Policy
          </Link>
        </nav>
      </header>

      <section className="hero-layout">
        <div className="hero-copy">
          <p className="eyebrow">Morning Calm, Built In</p>
          <h1 className="hero-title">Meet Your Child&apos;s New Routine Coach</h1>
          <p className="hero-subtitle">
            Fun, interactive morning workflows that help parents turn chaotic starts into
            calmer, more consistent days.
          </p>

          <div className="store-links" role="navigation" aria-label="Store links">
            <a
              href={siteConfig.appStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="store-badge-link"
            >
              <img
                className="store-badge ios"
                src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
                alt="Download on the App Store"
              />
            </a>
            <a
              href={siteConfig.playStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="store-badge-link android-link"
            >
              <img
                className="store-badge android"
                src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
                alt="Get it on Google Play"
              />
            </a>
          </div>
        </div>

        <section className="hero-stage" aria-label="Welcome video">
          {loading ? <p className="state-label">Loading welcome video...</p> : null}
          {!loading && videoError ? <p className="state-label error">{videoError}</p> : null}

          {videoSrc ? (
            <video
              key={videoSrc}
              className="welcome-video"
              src={videoSrc}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              controls={false}
              onError={() => {
                setVideoError('Welcome video is unavailable. Check public_site/config.welcomeVideoUrl.');
                setVideoSrc('');
              }}
            />
          ) : (
            <div className="video-fallback" aria-label="Video unavailable" />
          )}
        </section>
      </section>
    </main>
  );
}
