import { Link } from 'react-router-dom';
import '../styles/legal.css';

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link to="/" className="back-link">
          Back to Home
        </Link>

        <h1>Privacy Policy</h1>
        <p className="meta">Kidocoach | Last updated: 30/5/2026</p>

        <section>
          <h2>1. What Information We Collect</h2>
          <p>
            Right now, we only collect one piece of information: your email address. We collect this when
            you voluntarily submit it through our Early Access signup form.
          </p>
        </section>

        <section>
          <h2>2. How We Use Your Information</h2>
          <p>
            We use your email address for one specific purpose: to keep you informed about Kidocoach. This
            includes notifying you when the app launches, sending occasional development updates, and
            delivering your Founder&apos;s Pass early access details.
          </p>
        </section>

        <section>
          <h2>3. Data Sharing and Security</h2>
          <p>
            We do not sell, rent, or trade your email address to anyone. Period. Your data is stored
            securely using industry-standard infrastructure (Google Firebase).
          </p>
        </section>

        <section>
          <h2>4. Your Rights</h2>
          <p>
            You can opt-out of our communications at any time. Every email we send will include a clear
            &quot;Unsubscribe&quot; link at the bottom. If you want us to completely delete your email from our
            database before launch, simply reply to any of our emails and ask, and we will remove it
            immediately.
          </p>
        </section>

        <section>
          <h2>5. Contact Us</h2>
          <p>
            If you have any questions about this policy, you can reach us at tipyourtone@gmail.com.
          </p>
        </section>
      </article>
    </main>
  );
}
