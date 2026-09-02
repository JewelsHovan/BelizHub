import { createContext } from 'react';

// Cross-tab state: the Primers tab publishes its computed Tm pair and the amplicon length it found on the template,
// so the Protocol tab can pull both.
export const PrimerContext = createContext({ primerTm: null, setPrimerTm: () => {}, amplicon: null, setAmplicon: () => {} });
