import type { ReactNode } from 'react'

const contactEmail = import.meta.env.VITE_DEMO_CONTACT_EMAIL?.trim()

const features = [
  { number: '01', title: 'Coordina l’evento', text: 'Consulta la centrale, gli equipaggi e le postazioni da un unico spazio operativo.' },
  { number: '02', title: 'Registra una simulazione', text: 'Prova il flusso di un intervento con i dati di esempio predisposti per la demo.' },
  { number: '03', title: 'Segui l’attività', text: 'Esplora schieramento, aggiornamenti e archivio per capire come si collega il lavoro sul campo.' },
]

export default function DemoWelcome({ children }: { children: ReactNode }) {
  const presentationLink = contactEmail
    ? `mailto:${encodeURIComponent(contactEmail)}?subject=${encodeURIComponent('Presentazione VYTA MED')}`
    : null

  return <div className="demo-landing">
    <header className="demo-header">
      <a className="demo-brand" href="#inizio" aria-label="VYTA MED, inizio pagina">
        <img src="/icon.svg" alt="" /><span>VYTA MED</span>
      </a>
      <span className="demo-label">AMBIENTE DIMOSTRATIVO</span>
    </header>

    <main className="demo-main" id="inizio">
      <section className="demo-hero">
        <div className="demo-hero-copy">
          <p className="demo-eyebrow">COORDINAMENTO SANITARIO PER EVENTI</p>
          <h1>Un’unica regia per il soccorso allo stadio.</h1>
          <p className="demo-intro">Esplora come VYTA MED collega centrale operativa, equipaggi, postazioni e interventi durante un evento.</p>
          <div className="demo-actions">
            <a className="demo-primary" href="#demo-access">Entra nella demo <span aria-hidden="true">→</span></a>
            {presentationLink && <a className="demo-secondary" href={presentationLink}>Richiedi una presentazione</a>}
          </div>
          <p className="demo-note">Accesso riservato agli invitati · usa le credenziali che ti sono state fornite.</p>
        </div>

        <aside className="demo-steps" aria-label="Come provare la demo">
          <div className="demo-steps-heading"><span>IL PERCORSO</span><strong>Tre passaggi per orientarti</strong></div>
          {features.map(item => <div className="demo-step" key={item.number}>
            <span className="demo-step-number">{item.number}</span>
            <div><strong>{item.title}</strong><p>{item.text}</p></div>
          </div>)}
        </aside>
      </section>

      <section className="demo-features" aria-label="Funzioni da esplorare">
        <div><span className="demo-feature-mark">⌖</span><strong>Centrale operativa</strong><p>Una vista condivisa delle attività in corso.</p></div>
        <div><span className="demo-feature-mark">＋</span><strong>Interventi</strong><p>Registrazione e aggiornamento del flusso operativo.</p></div>
        <div><span className="demo-feature-mark">⇄</span><strong>Continuità offline</strong><p>Prova la coda locale e lo stato della sincronizzazione.</p></div>
      </section>

      <section className="demo-access" id="demo-access">
        <div className="demo-access-copy">
          <p className="demo-eyebrow">AREA DI PROVA</p>
          <h2>Accedi con il tuo invito</h2>
          <p>Ogni organizzazione invitata dovrebbe usare un account personale, così le prove restano attribuibili e non si sovrappongono.</p>
          <div className="demo-data-notice"><strong>Solo dati fittizi</strong><span>Non inserire nomi, contatti o informazioni sanitarie reali. L’ambiente demo serve esclusivamente per simulazioni.</span></div>
        </div>
        <div className="demo-login-card">{children}</div>
      </section>
    </main>

    <footer className="demo-footer"><span>VYTA MED</span><span>Ambiente dimostrativo · nessun dato reale</span></footer>
  </div>
}
