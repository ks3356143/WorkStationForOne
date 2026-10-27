import { useWorkstation } from '../../store/useWorkstation'
import { LearningLibrary } from './LearningView'
import { ReviewSession } from './ReviewSession'

export function LearningWorkspace() {
  const reviewOpen = useWorkstation((state) => state.learningReviewOpen)
  const startReview = useWorkstation((state) => state.startLearningReview)
  const exitReview = useWorkstation((state) => state.exitLearningReview)

  return reviewOpen ? (
    <ReviewSession onExit={exitReview} />
  ) : (
    <LearningLibrary onStartReview={startReview} />
  )
}
