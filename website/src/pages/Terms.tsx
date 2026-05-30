import { Link } from 'react-router-dom';
import '../styles/legal.css';

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link to="/" className="back-link">
          Back to Home
        </Link>

        <h1>Terms and Conditions</h1>
        <p className="meta">Kidocoach | Last updated: 30/5/2026</p>

        <p>
          Welcome to Kidocoach! These terms govern your participation in our Early Access waitlist.
        </p>

        <section>
          <h2>1. The Service</h2>
          <p>
            Kidocoach is currently in active development. By providing your email address, you are joining a
            waitlist to receive updates and early access opportunities. This waitlist does not guarantee
            immediate access to the final app, nor does it lock in specific features.
          </p>
        </section>

        <section>
          <h2>2. Communication</h2>
          <p>
            By submitting your email, you agree to receive promotional and informational emails from
            Kidocoach regarding our upcoming launch. You can withdraw this consent at any time by clicking
            &quot;Unsubscribe&quot; in our emails.
          </p>
        </section>

        <section>
          <h2>3. App Features and Pricing</h2>
          <p>
            Any features, pricing (including the &quot;Founder&apos;s Pass&quot;), or designs shown on our landing page are
            representations of our current development goals and are subject to change before the final
            release.
          </p>
        </section>

        <section>
          <h2>4. Disclaimer of Warranties</h2>
          <p>
            Because the app is still in development, the Early Access waitlist is provided &quot;as is.&quot; We are
            working hard to build a great experience, but we cannot guarantee specific launch dates.
          </p>
        </section>
      </article>
    </main>
  );
}
