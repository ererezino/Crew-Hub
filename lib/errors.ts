type SupportedLocale = "en" | "fr";

const ERROR_PATTERNS_EN: ReadonlyArray<[RegExp, string]> = [
  [/schema cache/i, "The system is updating. Please try again in a moment."],
  [/column .+ does not exist/i, "A required field is missing. Please contact your administrator."],
  [/relation .+ does not exist/i, "A required table is missing. Please contact your administrator."],
  [/Could not find function/i, "This action is temporarily unavailable. Please contact your administrator."],
  [/violates row-level security/i, "You do not have permission to perform this action."],
  [/new row violates row-level security/i, "You do not have permission to create this record."],
  [/violates check constraint/i, "The value you entered is not valid. Please check and try again."],
  [/duplicate key value violates unique constraint/i, "This record already exists. Please check for duplicates."],
  [/violates foreign key constraint/i, "This record references data that does not exist or has been removed."],
  [/violates not-null constraint/i, "A required field is missing. Please fill in all required fields."],
  [/value too long for type/i, "The text you entered is too long. Please shorten it and try again."],
  [/invalid input syntax/i, "The value you entered is not in the correct format."],
  [/permission denied/i, "You do not have permission to perform this action."],
  [/canceling statement due to statement timeout/i, "The request took too long. Please try again."],
  [/deadlock detected/i, "A conflict occurred. Please try again."],
  [/connection refused/i, "Unable to reach the server. Please check your connection and try again."],
  [/PGRST/i, "Something went wrong with the request. Please try again."],
  [/JWT expired/i, "Your session has expired. Please log in again."],
  [/Could not find the .+ column/i, "A required field is missing. Please contact your administrator."],
];

const ERROR_PATTERNS_FR: ReadonlyArray<[RegExp, string]> = [
  [/schema cache/i, "Le système est en cours de mise à jour. Veuillez réessayer dans un instant."],
  [/column .+ does not exist/i, "Un champ requis est manquant. Veuillez contacter votre administrateur."],
  [/relation .+ does not exist/i, "Une table requise est manquante. Veuillez contacter votre administrateur."],
  [/Could not find function/i, "Cette action est temporairement indisponible. Veuillez contacter votre administrateur."],
  [/violates row-level security/i, "Vous n'avez pas la permission d'effectuer cette action."],
  [/new row violates row-level security/i, "Vous n'avez pas la permission de créer cet enregistrement."],
  [/violates check constraint/i, "La valeur saisie n'est pas valide. Veuillez vérifier et réessayer."],
  [/duplicate key value violates unique constraint/i, "Cet enregistrement existe déjà. Veuillez vérifier les doublons."],
  [/violates foreign key constraint/i, "Cet enregistrement fait référence à des données inexistantes ou supprimées."],
  [/violates not-null constraint/i, "Un champ requis est manquant. Veuillez remplir tous les champs obligatoires."],
  [/value too long for type/i, "Le texte saisi est trop long. Veuillez le raccourcir et réessayer."],
  [/invalid input syntax/i, "La valeur saisie n'est pas au bon format."],
  [/permission denied/i, "Vous n'avez pas la permission d'effectuer cette action."],
  [/canceling statement due to statement timeout/i, "La requête a pris trop de temps. Veuillez réessayer."],
  [/deadlock detected/i, "Un conflit est survenu. Veuillez réessayer."],
  [/connection refused/i, "Impossible de joindre le serveur. Vérifiez votre connexion et réessayez."],
  [/PGRST/i, "Une erreur est survenue. Veuillez réessayer."],
  [/JWT expired/i, "Votre session a expiré. Veuillez vous reconnecter."],
  [/Could not find the .+ column/i, "Un champ requis est manquant. Veuillez contacter votre administrateur."],
];

const FALLBACK_EN = "Something went wrong. Please try again.";
const FALLBACK_FR = "Une erreur est survenue. Veuillez réessayer.";

export function humanizeError(raw: string | null | undefined, locale?: SupportedLocale): string {
  const fallback = locale === "fr" ? FALLBACK_FR : FALLBACK_EN;

  if (!raw) {
    return fallback;
  }

  const patterns = locale === "fr" ? ERROR_PATTERNS_FR : ERROR_PATTERNS_EN;

  for (const [pattern, message] of patterns) {
    if (pattern.test(raw)) {
      return message;
    }
  }

  if (raw.length > 200 || /[{[\]()}]|::|pg_|plpgsql|ERROR:/i.test(raw)) {
    return fallback;
  }

  return raw;
}
