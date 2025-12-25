/**
 * ReportsApi 클라이언트 예시 코드
 * 
 * 이 파일은 클라이언트 프로젝트에 추가할 ReportsApi 클래스의 예시입니다.
 * 실제 프로젝트 구조에 맞게 수정하여 사용하세요.
 */

class ReportsApi {
    private baseUrl: string;

    constructor(baseUrl: string = '/api') {
        this.baseUrl = baseUrl;
    }

    /**
     * tipos 테이블의 모든 데이터를 가져옵니다.
     * @returns Promise<Tipo[]> - tipos 테이블의 모든 레코드
     */
    async getTipos(): Promise<Tipo[]> {
        try {
            const response = await fetch(`${this.baseUrl}/tipos?all=true`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    // 필요한 경우 데이터베이스 헤더 추가
                    // 'X-DB-Host': 'your-host',
                    // 'X-DB-Port': '5432',
                    // 'X-DB-Name': 'your-database',
                    // 'X-DB-User': 'your-user',
                    // 'X-DB-Password': 'your-password',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Error fetching tipos:', error);
            throw error;
        }
    }

    /**
     * temporadas 테이블의 모든 데이터를 가져옵니다.
     * @returns Promise<Temporada[]> - temporadas 테이블의 모든 레코드
     */
    async getTemporadas(): Promise<Temporada[]> {
        try {
            const response = await fetch(`${this.baseUrl}/temporadas?all=true`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    // 필요한 경우 데이터베이스 헤더 추가
                    // 'X-DB-Host': 'your-host',
                    // 'X-DB-Port': '5432',
                    // 'X-DB-Name': 'your-database',
                    // 'X-DB-User': 'your-user',
                    // 'X-DB-Password': 'your-password',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            return result.data || [];
        } catch (error) {
            console.error('Error fetching temporadas:', error);
            throw error;
        }
    }
}

// 타입 정의 예시
interface Tipo {
    tpcodigo: string;
    tpdesc?: string;
    tpinfo1?: string;
    utime?: string;
    borrado?: boolean;
    id_tipo?: number;
}

interface Temporada {
    id_temporada: number;
    temporada_nombre?: string;
    utime?: string;
    borrado?: boolean;
}

// 사용 예시
/*
const reportsApi = new ReportsApi();

// tipos 가져오기
reportsApi.getTipos()
    .then(tipos => {
        console.log('Tipos:', tipos);
    })
    .catch(error => {
        console.error('Failed to get tipos:', error);
    });

// temporadas 가져오기
reportsApi.getTemporadas()
    .then(temporadas => {
        console.log('Temporadas:', temporadas);
    })
    .catch(error => {
        console.error('Failed to get temporadas:', error);
    });
*/

export default ReportsApi;
export type { Tipo, Temporada };

