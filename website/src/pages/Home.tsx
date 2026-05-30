import { FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVisibility } from '../hooks/useVisibility';
import { useWelcomeVideo } from '../hooks/useWelcomeVideo';
import { trackEvent } from '../services/analytics';
import { submitEarlyAccessLead } from '../services/earlyAccess';
import { SiteConfig } from '../services/siteConfig';
import '../styles/home.css';

const FALLBACK: SiteConfig = {
  welcomeVideoUrl: 'avatars/default/welcome.mp4',
  welcomeCaptionUrl: '/welcome-captions.vtt',
  appStoreUrl: 'https://apps.apple.com/',
  playStoreUrl: 'https://play.google.com/store',
};

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const heroStageRef = useRef<HTMLElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSignupOpen, setIsSignupOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState('');

  const {
    loading,
    videoSrc,
    captionSrc,
    videoError,
    hasStarted,
    shouldShowSignup,
    handleStartVideo,
    handleVideoEnded,
    handleVideoPlay,
    handleVideoError,
  } = useWelcomeVideo({ videoRef, fallbackConfig: FALLBACK });

  const isVideoFullyVisible = useVisibility(heroStageRef, 0.75);

  function openSignupModal(source: 'ios_badge' | 'android_badge' | 'floating_button') {
    setIsSignupOpen(true);
    trackEvent('early_access_modal_open', { source });
  }

  function closeSignupModal() {
    setIsSignupOpen(false);
    trackEvent('early_access_modal_close');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isValidEmail) {
      setSubmitState('error');
      setSubmitMessage('Enter a valid email address to reserve early access.');
      trackEvent('early_access_submit_invalid_email');
      return;
    }

    try {
      setSubmitState('submitting');
      setSubmitMessage('');
      trackEvent('early_access_submit_attempt');
      const result = await submitEarlyAccessLead(normalizedEmail);

      if (result.status === 'exists') {
        setSubmitState('success');
        setSubmitMessage('That email is already on the early access list.');
        trackEvent('early_access_submit_exists');
        return;
      }

      setSubmitState('success');
      setSubmitMessage("You're on the list. We'll reach out before early access opens.");
      setEmail('');
      trackEvent('early_access_submit_success');
    } catch (error) {
      console.warn('Failed to submit early access lead', error);
      setSubmitState('error');
      setSubmitMessage('Could not save your email right now. Please try again.');
      trackEvent('early_access_submit_error');
    }
  }

  function handleJumpToVideo() {
    const stageNode = heroStageRef.current;
    if (!stageNode || typeof window === 'undefined') {
      return;
    }

    const stageTop = stageNode.getBoundingClientRect().top + window.scrollY;
    const targetTop = Math.max(stageTop - 24, 0);

    // Keep this cue directional: it should only move the user downward toward the video.
    if (window.scrollY >= targetTop) {
      return;
    }

    window.scrollTo({ top: targetTop, behavior: 'smooth' });
  }

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
            Kidocoach is a daily routine app for kids built for morning routines, bedtime
            routines, and daily habits, helping parents raise independent children with a
            playful routine experience.
          </p>
        </div>

        <section ref={heroStageRef} className="hero-stage" aria-label="Welcome video">
          {loading ? <p className="state-label">Loading welcome video...</p> : null}
          {!loading && videoError ? <p className="state-label error">{videoError}</p> : null}

          {videoSrc ? (
            <video
              ref={videoRef}
              key={`${videoSrc}:${captionSrc}`}
              className="welcome-video"
              src={videoSrc}
              playsInline
              preload="auto"
              controls={false}
              onEnded={handleVideoEnded}
              onPlay={handleVideoPlay}
              onError={handleVideoError}
            >
              {captionSrc ? (
                <track kind="captions" srcLang="en" label="English" src={captionSrc} default />
              ) : null}
            </video>
          ) : (
            <div className="video-fallback" aria-label="Video unavailable" />
          )}

          {videoSrc && !hasStarted && !shouldShowSignup ? (
            <button className="video-start-button" type="button" onClick={handleStartVideo}>
              Play welcome video
            </button>
          ) : null}

          {shouldShowSignup ? (
            <p className="signup-ready-hint">Early access is open now</p>
          ) : null}
        </section>
      </section>

      <div className="floating-store-links" role="navigation" aria-label="Store links">
        <button
          className="store-badge-link pseudo-badge"
          type="button"
          onClick={() => openSignupModal('ios_badge')}
          aria-label="Join early access for iOS"
        >
          <img
            className="store-badge ios"
            src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg"
            alt="Coming soon to the App Store"
          />
        </button>
        <button
          className="store-badge-link pseudo-badge android-link"
          type="button"
          onClick={() => openSignupModal('android_badge')}
          aria-label="Join early access for Android"
        >
          <img
            className="store-badge android"
            src="https://upload.wikimedia.org/wikipedia/commons/7/78/Google_Play_Store_badge_EN.svg"
            alt="Coming soon to Google Play"
          />
        </button>
        <button
          className="floating-signup-button"
          type="button"
          onClick={() => openSignupModal('floating_button')}
        >
          Early Access Signup
        </button>
      </div>

      {!isVideoFullyVisible ? (
        <button
          className="scroll-cue"
          type="button"
          aria-label="Scroll to welcome video"
          onClick={handleJumpToVideo}
        >
          <span className="scroll-cue-text">Scroll</span>
          <span className="scroll-cue-arrow" aria-hidden="true">↓</span>
        </button>
      ) : null}

      {isSignupOpen ? (
        <div className="signup-modal-backdrop" onClick={closeSignupModal}>
          <div
            className="signup-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Early access signup"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="signup-modal-close"
              type="button"
              aria-label="Close signup"
              onClick={closeSignupModal}
            >
              Close
            </button>

            <div className="signup-panel" aria-live="polite">
              <p className="signup-kicker">Early Access</p>
              <h2 className="signup-title">Reserve your Founder&apos;s Pass</h2>
              <p className="signup-copy">
                Enter your email to lock in early access updates and the launch-rate offer.
              </p>

              <form className="signup-form" onSubmit={handleSubmit}>
                <label className="signup-label" htmlFor="early-access-email">
                  Email address
                </label>
                <input
                  id="early-access-email"
                  className="signup-input"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (submitState !== 'idle') {
                      setSubmitState('idle');
                      setSubmitMessage('');
                    }
                  }}
                  disabled={submitState === 'submitting' || submitState === 'success'}
                  required
                />
                <button
                  className="signup-button"
                  type="submit"
                  disabled={submitState === 'submitting' || submitState === 'success'}
                >
                  {submitState === 'submitting' ? 'Saving...' : submitState === 'success' ? 'Saved' : 'Join Early Access'}
                </button>
              </form>

              {submitMessage ? (
                <p className={`signup-message ${submitState}`}>{submitMessage}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
