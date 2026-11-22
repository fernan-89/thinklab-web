/**
 * The Portuguese text of the action buttons (Deploy, Acknowledge, ...), keyed by the English label that api/services.ts defines. English shows the label as it is.
 * A label without an entry is shown in English; a test checks that every action label of the areas already translated has one.
 */
export const actionPt: Record<string, string> = {
  'Mark ready': 'Marcar como pronto',
  Decommission: 'Desativar',
  Deploy: 'Implantar',
  'Start maintenance': 'Iniciar manutenção',
  'Return to ready': 'Voltar a pronto',
  Redeploy: 'Reimplantar',
};