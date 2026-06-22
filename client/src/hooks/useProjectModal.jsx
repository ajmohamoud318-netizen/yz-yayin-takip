import { createContext, useContext, useState } from 'react'

const ProjectModalCtx = createContext(null)

export function ProjectModalProvider({ children }) {
  const [projectId, setProjectId] = useState(null)
  return (
    <ProjectModalCtx.Provider
      value={{
        projectId,
        openProject: setProjectId,
        closeProject: () => setProjectId(null),
      }}
    >
      {children}
    </ProjectModalCtx.Provider>
  )
}

export function useProjectModal() {
  return useContext(ProjectModalCtx)
}
