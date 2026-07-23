import SpecFormDialog from '@/components/SpecFormDialog'

/**
 * Ozalit spec-sheet dialog — thin wrapper around the shared SpecFormDialog.
 * See SpecFormDialog.jsx (VARIANTS.ozalit) for all ozalit-specific behavior.
 */
export default function OzalitFormDialog({ mode = 'approve', ...props }) {
  return <SpecFormDialog variant="ozalit" mode={mode} {...props} />
}
