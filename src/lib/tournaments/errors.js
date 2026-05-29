// Tournament-domain typed errors. Base class for the whole tournaments domain
// (templates now; tournament create / lifecycle ops land here in later tasks),
// mirroring the per-domain error families in wallet/ and players/.

export class TournamentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TournamentError'
  }
}
